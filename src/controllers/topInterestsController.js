import User from '../models/User.js';
import Redis from 'ioredis';
import config from '../config/config.js';

// Redis 클라이언트 설정
const redisClient = new Redis({
    host: config.REDIS_HOST,
    password: config.REDIS_PASSWORD,
    retryStrategy: (times) => {

        // 연결 실패 시 재시도 전략
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

// Redis 에러 핸들링
redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

const CACHE_KEY = 'top_interests'; // 캐시 키
const LOCK_KEY = 'top_interests_lock'; // 락 키
const CACHE_EXPIRATION = 300; // 5분
const LOCK_EXPIRATION = 10; // 10초

// SETNX를 사용한 락 흭득 - NX옵션은 SETNX 명령어와 동일한 역할 수행. 키가 존재 하지 않을 떄만 설정되므로, 락 흭득 역할
async function acquireLock() {
    return await redisClient.set(LOCK_KEY, '1', 'EX', LOCK_EXPIRATION, 'NX');
}

// 작업 완료 후 락 해제
async function releaseLock() {
    await redisClient.del(LOCK_KEY);
}

async function getTopInterestsFromDB() {
    const interestsAggregation = await User.aggregate([
        { $unwind: '$interests2' },
        { $group: { _id: '$interests2', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
    ]).exec();
    return interestsAggregation.map(interest => interest._id);
}

// 상위 관심사 조회 API 핸들러
export const getTopInterests = async (req, res) => {
    console.log('In getTopInterests');
    try {

        // 캐시에서 데이터 조회
        let topInterests = JSON.parse(await redisClient.get(CACHE_KEY));

        if (!topInterests) {
            const locked = await acquireLock();

            // 락을 흭득한 프로세스만 데이터베이스 쿼리 실행 및 캐시 갱신
            if (locked) {
                try {
                    topInterests = await getTopInterestsFromDB();
                    await redisClient.setex(CACHE_KEY, CACHE_EXPIRATION, JSON.stringify(topInterests));
                    console.log('Updated top interests in cache');
                } finally {

                    // 작업 완료 후 락 해제
                    await releaseLock();
                }

            } else {

                // 다른 프로세스가 이미 업데이트 중이므로, 짧게 대기 후 다시 캐시 확인
                await new Promise(resolve => setTimeout(resolve, 100));
                topInterests = JSON.parse(await redisClient.get(CACHE_KEY));
            }
        }

        if (!topInterests) {

            // 여전히 데이터가 없다면 빈 배열 반환
            topInterests = [];
        }

        res.status(200).json({ topInterests });

    } catch (error) {

        console.error('Failed to fetch top interests:', error);
        res.status(500).json({ message: 'Failed to fetch top interests' });
    }
};

// 서버 시작 시 초기 데이터 로드
getTopInterestsFromDB()
    .then(async topInterests => {
        await redisClient.setex(CACHE_KEY, CACHE_EXPIRATION, JSON.stringify(topInterests));
        console.log('Initial top interests loaded into cache');
    })
    .catch(err => console.error('Failed to load initial top interests:', err));

// 서버 종료 시 Redis 연결 종료
process.on('SIGINT', () => {
    redisClient.quit();
    process.exit();
});
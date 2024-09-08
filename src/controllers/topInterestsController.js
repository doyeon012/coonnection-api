import User from '../models/User.js';
import Redis from 'ioredis';
import config from '../config/config.js';

const redisClient = new Redis({
    host: config.REDIS_HOST,
    password: config.REDIS_PASSWORD,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

const CACHE_KEY = 'top_interests';
const CACHE_EXPIRATION = 3600; // 1시간

export const getTopInterests = async (req, res) => {
    console.log('In getTopInterests');
    try {
        // 캐시에서 데이터 확인
        const cachedData = await redisClient.get(CACHE_KEY);
        if (cachedData) {
            console.log('Returning cached top interests');
            return res.status(200).json({ topInterests: JSON.parse(cachedData) });
        }

        // 캐시에 없으면 데이터베이스에서 계산
        const interestsAggregation = await User.aggregate([
            { $unwind: '$interests2' },
            { $group: { _id: '$interests2', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
        ]);

        const topInterests = interestsAggregation.map(interest => interest._id);
        console.log('상위 관심사:', topInterests);

        // 결과를 캐시에 저장
        await redisClient.setex(CACHE_KEY, CACHE_EXPIRATION, JSON.stringify(topInterests));

        res.status(200).json({ topInterests });
        
    } catch (error) {
        console.error('Failed to fetch top interests:', error);
        res.status(500).json({ message: 'Failed to fetch top interests' });
    }
};

// 서버 종료 시 Redis 연결 종료
process.on('SIGINT', () => {
    redisClient.quit();
    process.exit();
});
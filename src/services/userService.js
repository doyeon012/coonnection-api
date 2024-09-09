import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'; // AWS S3 클라이언트 라이브러리 가져오기
import multer from 'multer';
import { Worker } from 'worker_threads';

import config from '../config/config.js'; // 설정 파일 가져오기
import User from '../models/User.js'; // 사용자 모델 가져오기

import { redisClient } from '../../server.js';

import path from 'path';
import { fileURLToPath } from 'url';

// S3 클라이언트 설정
const s3 = new S3Client({
    region: config.AWS_REGION,  //AWS 리전 설정
    credentials: {
        accessKeyId: config.AWS_ACCESS_KEY, // AWS 액세스 키 설정
        secretAccessKey: config.AWS_SECRET_KEY, // AWS 시크릿 키 설정
    },
});

// 파일 업로드 객체 생성 (메모리에 저장)
const upload = multer({
    storage: multer.memoryStorage(), // 메모리에 파일 저장
    limits: { fileSize: 5 * 1024 * 1024 }, // 파일 크기 제한: 5MB
});

// 파일 업로드 미들웨어 설정
export const uploadMiddleware = upload.single('profileImage');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// updateUserProfile 함수 수정
export const updateUserProfile = async (userId, file, interests, mbti) => {
    try {
      const updateData = {};
      if (interests) updateData.interests = interests;
      if (mbti) updateData.mbti = mbti;
  
      // 이미지 업로드를 비동기적으로 처리
      if (file) {
        const worker = new Worker(path.join(__dirname, '..', 'workers', 'imageUploadWorker.js'), {
          workerData: { file },
          type: 'module'
        });
      
        worker.on('message', async (result) => {
          if (result.error) {
            console.error('Worker error:', result.error);
          } else {
            await User.findByIdAndUpdate(userId, { profileImage: result }, { new: true });
          }
        });
      
        worker.on('error', (error) => {
          console.error('Worker error:', error);
        });
      
        worker.on('exit', (code) => {
          if (code !== 0) {
            console.error(`Worker stopped with exit code ${code}`);
          }
        });
      }
  
      // 이미지 외 다른 정보 즉시 업데이트
      const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true });
      return updatedUser;
    } catch (error) {
      throw new Error('Error updating user profile: ' + error.message);
    }
  };

// 사용자 정보를 조회하는 함수
export const getUserProfile = async (userId) => {
    try {
        // 사용자 정보를 조회
        const user = await User.findById(userId);

        // 조회된 사용자 정보를 반환
        return user;
    } catch (error) {
        throw new Error('Error fetching user profile: ' + error.message);
    }
};

// AI 관심사 조회
export const getAiInterests = async (userId) => {
    try {
        const user = await User.findById(userId).select('interests2');
        if (user && user.interests2 && user.interests2.length > 0) {
            return user.interests2[0]; // 첫 번째 값 반환
        } else {
            throw new Error('No AI interests found');
        }
    } catch (error) {
        throw new Error('Error fetching AI interests: ' + error.message);
    }
};

// 세션에 따른 유저 데이터 조회 서비스 함수
export const getSessionDataService = async (sessionId) => {
    try {
        const sessionData = await redisClient.hgetall(sessionId);
        if (!sessionData) {
            throw new Error('Session not found');
        }

        // Redis에서 가져온 데이터 파싱
        const parsedData = Object.entries(sessionData).map(([userId, data]) => {
            const parsedUserData = JSON.parse(data);
            return {
                userId,
                socketId: parsedUserData.socketId,

                userInterests: parsedUserData.userInterests, // 배열로 저장된 interests
                aiInterests: parsedUserData.aiInterests,
                nickname: parsedUserData.nickname,
                mbti: parsedUserData.mbti,
                question: parsedUserData.question,
                answer: parsedUserData.answer
            };
        });

        return parsedData;
    } catch (error) {
        console.error('Error in getSessionDataService:', error);
        throw error;
    }
};

// 통화 유저 정보 조회 서비스 함수
export const getCallUserInfoService = async (usernames) => {
    try {
        const users = await User.find({ username : { $in: usernames  } }).select('profileImage utterance nickname');
        return users;
    } catch (error) {
        console.error('Error in getCallUserInfoService:', error);
        throw error;
    }
};
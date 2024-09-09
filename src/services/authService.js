import { S3Client } from '@aws-sdk/client-s3'; // AWS S3 클라이언트 라이브러리 가져오기
import { Upload } from '@aws-sdk/lib-storage'; // AWS S3 업로드 라이브러리 가져오기
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/config.js'; // 설정 파일 가져오기
import User from '../models/User.js';
import bcrypt from 'bcryptjs'; // 비밀번호 해시화를 위한 bcryptjs 라이브러리 가져오기
import jwt from 'jsonwebtoken'; // JSON Web Token 라이브러리 가져오기
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



// 파일 업로드 객체 생성 (메모리에 저장)
const upload = multer({
    storage: multer.memoryStorage(), // 메모리에 파일 저장
    limits: { fileSize: 5 * 1024 * 1024 }, // 파일 크기 제한: 5MB
});

// 파일 업로드 미들웨어 설정
export const uploadMiddleware = upload.single('profileImage');

// JWT 토큰을 생성하는 함수 정의
export const generateToken = (user) => {
    return jwt.sign(
        {
            id: user._id,
            username: user.username,
            name: user.name,
            email: user.email,
        },
        config.JWT_SECRET,
        { expiresIn: '24h' }
    );
};

// 회원가입 기능 구현
export const register = async (userData) => {
    const {
        username,
        password,
        name,
        email,
        interests,
        interests2, // interests2 필드 추가
        nickname,
        profileImage,
        mbti,
    } = userData;

    let profileImageUrl = null; //프로필 이미지 URL 초기화
    try {
        if (profileImage) {
            const worker = new Worker(path.join(__dirname, '..', 'workers', 'imageUploadWorker.js'), {
                workerData: { file: profileImage },
                type: 'module'
            });

            profileImageUrl = await new Promise((resolve, reject) => {
                worker.on('message', resolve);
                worker.on('error', reject);
                worker.on('exit', (code) => {
                    if (code !== 0)
                        reject(new Error(`Worker stopped with exit code ${code}`));
                });
            });

            if (typeof profileImageUrl === 'object' && profileImageUrl.error) {
                throw new Error(profileImageUrl.error);
            }
        }

        const user = new User({
            username,
            password,
            name,
            email,
            interests,
            interests2,
            nickname,
            profileImage: profileImageUrl,
            mbti,
        });

        await user.save();
        const token = generateToken(user);

        return { token, user };
    } catch (error) {
        console.error('Error during registration:', error);
        throw new Error(error.message);
    }
};

// 로그인 기능 구현
export const login = async ({ username, password }) => {
    console.log('Login endpoint called with data:', { username, password });
    try {
        // DB에 사용자 이름으로 사용자 찾기.
        const user = await User.findOne({ username });
        if (!user) {
            console.log('User not found');
            throw new Error('Invalid username or password'); // 사용자가 존재하지 않을 경우 에러 발생
        }

        // 입력된 비밀번호와 저장된 비밀번호 비교
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log('Password does not match');
            throw new Error('Invalid username or password');
        }
        const token = generateToken(user); // 로그인 시 토큰 생성
        return { token, user };
    } catch (error) {
        console.error('Error during login:', error);
        throw error;
    }
};

// 사용자 중복 검사 함수 추가
export const checkUsername = async (username) => {
    const user = await User.findOne({ username });
    return user ? true : false;
};

// 사용자 삭제 로직
export const deleteUserById = async (userId) => {
    try {
        await User.findByIdAndDelete(userId); // MongoDB에서 사용자 삭제
    } catch (error) {
        throw new Error('Error deleting user: ' + error.message);
    }
};
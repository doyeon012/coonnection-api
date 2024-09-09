// Worker Threads에서 사용할 S3 클라이언트와 이미지 처리 모듈 및 설정 파일 불러오기
import { parentPort, workerData } from 'worker_threads';
import config from '../config/config.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

// S3 클라이언트 설정 (리전 및 자격 증명 포함)
const s3 = new S3Client({
    region: config.AWS_REGION, // S3 리전 설정
    credentials: {
        accessKeyId: config.AWS_ACCESS_KEY, // S3 액세스 키 설정
        secretAccessKey: config.AWS_SECRET_KEY, // S3 시크릿 키 설정
    },
});

// 이미지를 최적화하는 함수
// Sharp 라이브러리를 사용해 이미지를 500x500 크기로 조정하고, 80% 품질로 압축
const optimizeImage = async (file) => {
  const optimizedBuffer = await sharp(file.buffer) // Sharp로 이미지 처리
    .resize({ width: 500, height: 500, fit: 'inside' }) // 크기 조정 (500x500)
    .jpeg({ quality: 80 }) // JPEG로 변환하며 80% 품질로 압축
    .toBuffer(); // 최종 이미지를 버퍼 형태로 반환
  return optimizedBuffer; // 최적화된 이미지 반환
};

// 최적화된 이미지를 S3에 업로드하는 함수
const uploadFileToS3 = async (file) => {

  // 이미지 최적화 후 S3에 업로드할 준비
  const optimizedBuffer = await optimizeImage(file); // 최적화된 이미지 버퍼 생성

  const params = {
    Bucket: config.AWS_BUCKET_NAME, // 업로드할 S3 버킷 이름
    Key: `img/${uuidv4()}-${file.originalname}`, // 파일명에 UUID를 추가하여 고유하게 만듦
    Body: optimizedBuffer, // 최적화된 이미지 데이터를 S3에 저장
    ContentType: file.mimetype, // 파일의 MIME 타입 설정
  };

  // S3에 업로드 명령 실행
  const command = new PutObjectCommand(params); // S3 PutObjectCommand를 통해 업로드 명령 생성

  await s3.send(command); // S3로 파일 전송

  // 업로드된 파일의 S3 URL 반환
  return `https://${config.AWS_BUCKET_NAME}.s3.${config.AWS_REGION}.amazonaws.com/${params.Key}`;
};

// 워커 스레드에서 비동기 함수 실행
// 업로드 성공 시 이미지 URL을 전송, 실패 시 에러 메시지를 전송
(async () => {
  try {
    const { file, userId  } = workerData; // workerData에서 전달된 파일 데이터를 가져옴

    const profileImageUrl = await uploadFileToS3(file); // S3에 파일 업로드 후 URL 반환
    parentPort.postMessage(profileImageUrl, userId ); // 업로드 성공 시 결과 URL을 메인 스레드에 전달
  } catch (error) {
    parentPort.postMessage({ error: error.message }); // 에러 발생 시 에러 메시지를 메인 스레드로 전달
  }
})();

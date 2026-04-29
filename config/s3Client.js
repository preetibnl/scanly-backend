import { S3Client } from "@aws-sdk/client-s3";

const getRequiredEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};
export const getS3Config = () => {
  const region = getRequiredEnv("AWS_REGION");
  const bucketName = getRequiredEnv("AWS_S3_BUCKET_NAME");
  const accessKeyId = getRequiredEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnv("AWS_SECRET_ACCESS_KEY");

  return {
    region,
    bucketName,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  };
};

export const getS3Client = () => {
  const { region, credentials } = getS3Config();
  return new S3Client({ region, credentials });
};

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://hukmee:unused@localhost:5432/hukmee_test";
process.env.JWT_ACCESS_SECRET =
  "test-secret-with-more-than-thirty-two-characters";
process.env.SESSION_SECRET =
  "test-session-secret-with-more-than-thirty-two-characters";
process.env.CORS_ORIGINS = "http://localhost:3000";
process.env.AUTH_RATE_LIMIT_MAX = "100";
process.env.OTP_DEV_STATIC_CODE = "123456";
process.env.OTP_CHALLENGE_TTL_SECONDS = "300";
process.env.OTP_MAX_ATTEMPTS = "3";
process.env.LOG_LEVEL = "silent";

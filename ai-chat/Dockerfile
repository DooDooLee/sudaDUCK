# 1. 빌드 단계
# 17-jdk-alpine 은 arm64(Apple Silicon) 이미지가 없어서 우분투 기반 JDK 를 쓴다
FROM eclipse-temurin:17-jdk AS build
WORKDIR /app

# 의존성 레이어를 먼저 캐시한다
COPY gradlew .
COPY gradle gradle
COPY build.gradle .
COPY settings.gradle .
RUN chmod +x ./gradlew
RUN ./gradlew dependencies --no-daemon

# 소스 복사 후 실행 jar 빌드 (테스트 생략)
COPY src src
RUN ./gradlew clean bootJar -x test --no-daemon

# ---------------------------------------------------------

# 2. 실행 단계. 네이티브 라이브러리가 필요 없어서 JRE 만 쓴다
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
EXPOSE 8081
# 설정은 모두 환경변수로 받는다 (REDIS_HOST, OPENAI_BASE_URL, JWT_SECRET 등)
ENTRYPOINT ["java", "-jar", "app.jar"]

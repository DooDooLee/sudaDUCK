# A(backend/) 벤치용 이미지. backend/Dockerfile 과 같지만 빌드 단계 베이스만 다르다.
# eclipse-temurin:17-jdk-alpine 은 arm64(Apple Silicon) 이미지가 없어서 우분투 기반 17-jdk 를 쓴다.
# (amd64 에뮬레이션으로 돌리면 B 와 조건이 달라지므로 네이티브 arm64 로 빌드한다)
# 빌드 컨텍스트는 ../backend (docker-compose.yml 참고)

# 1. 빌드 단계
FROM eclipse-temurin:17-jdk AS build
WORKDIR /app
COPY gradlew .
COPY gradle gradle
COPY build.gradle .
COPY settings.gradle .
RUN chmod +x ./gradlew
RUN ./gradlew dependencies --no-daemon
COPY src src
RUN ./gradlew clean bootJar -x test --no-daemon

# 2. 실행 단계 (backend/Dockerfile 과 동일)
FROM eclipse-temurin:17-jre
WORKDIR /app
RUN apt-get update && apt-get install -y \
    libssl-dev \
    libasound2t64 \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/build/libs/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]

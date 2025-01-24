# WebRTC-RTMP 스트리밍 테스트

WebRTC를 활용한 실시간 P2P 화상 채팅과 RTMP 기반 방송 기능을 결합한 스트리밍 플랫폼 구현을 위한 테스트

## 🚀 주요 기능

- WebRTC 기반 P2P 화상 채팅 (권장 인원: 6명 이하)
- RTMP 스트리밍 방송 지원
- 실시간 음성/영상 통신
- 동적 참여자 관리
- 크로스 플랫폼 지원

## 🏗️ 시스템 구조

### WebRTC 구현
- Mesh 방식의 P2P 연결 구조
- WebSocket 시그널링 서버
- 로컬 미디어 스트림 처리
- ICE candidate 교환
- 동적 피어 연결 관리

### RTMP/HLS 스트리밍
- FFmpeg 기반 스트림 변환
- WebSocket 데이터 전송
- RTMP 서버 스트림 배포
- RTMP에서 HLS로 변환 (.ts 세그먼트 파일 생성) → 진짜 구현했는데 코드 실종..
- VLC, ffplay 등 표준 RTMP/HLS 플레이어 지원

## 🔧 기술 스택

- WebRTC API
- WebSocket
- FFmpeg
- MediaRecorder API

## ⚙️ 동작 과정

### WebRTC 흐름
1. WebSocket 서버 연결
2. 로컬 미디어 스트림 획득
3. P2P 연결 설정
4. ICE candidate 교환
5. 미디어 스트림 전송

### RTMP/HLS 흐름
1. MediaRecorder로 스트림 캡처
2. WebSocket으로 데이터 전송
3. FFmpeg 변환 처리
4. RTMP 스트림 배포
5. HLS .ts 세그먼트 생성 및 저장

## ⚠️ 성능 테스트 결과

![alt text](image.png)

### WebRTC Mesh 성능
- 6명까지: 안정적인 연결과 성능 유지
- 7명 이상: 눈에 띄는 CPU 사용량 증가와 성능 저하 발생
  - MacBook 기준 CPU 사용률 80% 이상 급증
  - 영상/음성 지연 현상 발생
- 권장 인원: 6명 이하

### RTMP 스트리밍 성능
- 스트리밍 지연 시간: 5초 (실측값)
- 장점: 다수의 시청자 동시 시청 가능
- 제약사항: 실시간 양방향 소통이 필요한 경우 부적합

# 금고군협전 세이브 에디터 (`JinGu Save Editor v1.0`)

스팀 게임 **금고군협전** (`JinGu`, AppID `3313720`)의 세이브 파일(`*.bytes`)과 전역 설정 파일(`Global/Setting.bytes`)을 안전하게 열람·검증·수정할 수 있는 한국어 3-Surface 세이브 에디터입니다.

> **안내**: 게임 리소스에서 추출한 100% 한국어 카탈로그와 `SaveData`(76개 필드) / `GlobalData`(10개 필드) 스키마를 기반으로 설계되었으며, 모든 UI·CLI·오류 메시지는 순수 한국어만 제공합니다.

## 주요 기능

- **완전 호환 암복호화 코덱**
  - PBKDF2-HMAC-SHA1 (`MyPassword`, 고정 솔트 8바이트, 1,000회 반복, 48바이트 파생 키/IV) + AES-256-CBC PKCS7 암복호화 지원
  - 무손실 `Int64` 토크나이저 적용: `.NET DateTime.Ticks` (`m_saveTime`, `m_itemTimeDic` 등 64비트 정수)의 하위 자릿수 반올림 손실 방지
  - `SaveData` (`*.bytes`) 및 `GlobalData` (`Setting.bytes`) 자동 판별 및 스키마 검증 (`m_yangCheng` 불리언 타입 포함)
- **풍부한 한국어 데이터 카탈로그**
  - 아이템(954종), 장비(135종, 장착 변경 시 `LeaderId` 동기화), 무학(205종), 초식(1,364종), 심법/패시브(549종), 글로벌 버프(103종), 인물(499명), 동료(16명), 동물(14종), 장면(165곳), 퀘스트(281종), 실전 감오 트리(80노드), 단방(26종), 단조 도안(50종), 업적(175종), 효과/속성(80종)
- **안전 장치 및 무결성 보호**
  - 세이브 수정 전 `JinGu.exe` 실행 여부 감지 및 차단 (`JGSE_SIMULATE_GAME_RUNNING=1` 시뮬레이션 지원)
  - 저장 전 타임스탬프 백업(`.backup-*.bak`) 생성 및 SHA-256 동시 수정 충돌(`expectedSha256`) 검증
  - Windows NTFS 심볼릭 링크/정션/하드 링크/대체 데이터 스트림(ADS)/예약 장치명 차단 및 KTM TxF 트랜잭션 원자적 교체
  - HTTP 루프백 모드에서 `Host` / `Origin` / `Sec-Fetch-Site` 검사 및 `X-JinGu-Token` CSRF 보호

## 3가지 실행 방식 (3-Surface)

### 1. 오프라인 단일 HTML (`dist/JinGuSaveEditor-v1.0.html`)
- 외부 CDN·네트워크 요청 0건(`CSP default-src 'none'`), 단일 HTML 파일 하나만으로 최신 브라우저에서 오프라인 실행 가능
- 파일 업로드, 데모 `SaveData`/`GlobalData` 생성, 6개 편집 탭(`기본 요약`, `속성/능력치`, `무학/심법`, `가방/장비`, `동료/호감`, `세계/도감`) 및 전역 설정 도감 편집, 프리셋 적용, 변경 내역 비교(`Diff`) 및 `.bytes` 다운로드 지원

### 2. Python 표준 라이브러리 CLI & 로컬 서버 (`jingu_editor.py`)
외부 패키지 설치 없이 Python 3 표준 라이브러리만으로 동작합니다.

```bash
# 사용 가능한 프리셋 목록 확인
python3 -B jingu_editor.py presets

# 데모 SaveData / GlobalData 생성 및 왕복 검증
python3 -B jingu_editor.py demo demo.bytes
python3 -B jingu_editor.py demo Setting.bytes --global

# 세이브 무결성 검증 및 요약 열람
python3 -B jingu_editor.py validate Save1.bytes
python3 -B jingu_editor.py inspect Save1.bytes

# CLI 직접 편집 (자동 .backup-*.bak 백업 생성)
python3 -B jingu_editor.py edit Save1.bytes --money 1000000 --points 999 --set-effect 101=100 --max-wuxue
python3 -B jingu_editor.py edit Setting.bytes --unlock-all-global

# 로컬 루프백 웹 UI 서버 실행
python3 -B jingu_editor.py serve
```

### 3. Windows x64 독립 실행형 앱 (`JinGuSaveEditor-v1.0.exe`)
- `.NET Framework 4.8` WinForms + Microsoft Edge WebView2 기반 네이티브 데스크톱 실행 파일
- `%USERPROFILE%\AppData\LocalLow\금고 스튜디오` 대신 실제 게임 회사 폴더 경로와 Steam 클라우드(`3313720\remote`)의 `*.bytes`를 자동 탐색하며, 저장 시 KTM TxF 트랜잭션으로 백업 및 교체를 수행합니다.
- 실행에는 `JinGuSaveEditor-v1.0.exe`와 함께 배포된 `Microsoft.Web.WebView2.Core.dll`, `Microsoft.Web.WebView2.WinForms.dll`, `WebView2Loader.dll`이 같은 폴더에 있어야 합니다.

## 세이브 파일 기본 경로 (Windows)
- 로컬 세이브: `%USERPROFILE%\AppData\LocalLow\<개발사 폴더>\JinGu\SaveDatas\` (상위 폴더, `Fixed\`, `AutoSave\`, `Global\Setting.bytes`)
- Steam 클라우드: `<Steam>\userdata\<SteamID>\3313720\remote\`

## 빌드 및 테스트

```bash
# 1. 카탈로그 정합성 검사 (한자·HTML 태그 0건 확인)
python3 -B tools/extract_catalog.py --check-only

# 2. 오프라인 HTML 번들 빌드
python3 -B build.py

# 3. Node.js 코덱/세션/HTML 감사 테스트 (8개 항목)
node tests/test_editor.cjs

# 4. Python CLI·암호화·HTTP 서버 단위 테스트 (13개 항목)
python3 -W error -B -m unittest discover -s tests -v
```

Windows x64 네이티브 모듈 테스트 및 셀프테스트(`Windows 10/11`, `.NET 4.8 csc.exe` 환경):
```bat
csc.exe /nologo /platform:x64 /target:exe /main:JinGuSaveEditor.Tests.SaveStoreTests /out:SaveStoreTests.exe /r:Microsoft.Web.WebView2.Core.dll /r:Microsoft.Web.WebView2.WinForms.dll /r:System.Web.Extensions.dll src\SaveStore.cs src\SaveEditor.cs tests\SaveStoreTests.cs
SaveStoreTests.exe

JinGuSaveEditor-v1.0.exe --self-test receipt.json
```

## 라이선스
- 본 프로젝트 코드는 [MIT License](LICENSE)를 따릅니다.
- Windows 배포 패키지에는 Microsoft Edge WebView2 SDK 재배포 라이선스(`WebView2-LICENSE.txt`)가 포함됩니다.

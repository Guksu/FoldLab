# FoldLab 자료 조사 (2026-10-06 기준)

FoldLab을 만들면서 확인한 기기 치수, 웹 플랫폼 API, 실제 기기 동작, 에뮬레이션 방법, 검사 규칙의 근거, 기존 도구를 정리했다.
숫자마다 출처를 달았고, 실기기에서 확인하지 못한 값은 **추정**이라고 적었다.

## 1. 핵심 요약

1. **아이폰 듀오는 실제 제품이다.** 애플이 2026-09-09에 발표했고 10-23에 출시한다. 바깥 5.4″(1398×2034, 460ppi), 안쪽 7.6″(1878×2670, 430ppi)이고 여권처럼 책형으로 접는다. 상태 표시줄과 다이내믹 아일랜드가 **오른쪽 세로 막대**로 옮겨 가서 안전 영역이 좌우 비대칭이다(위 0 · 오른쪽 84 · 아래 34pt). [Apple 사양](https://www.apple.com/iphone-duo/specs/) · [뉴스룸](https://www.apple.com/newsroom/2026/09/apple-unveils-iphone-duo/) · [safearea.info](https://safearea.info/iphone-duo) · [plurigent](https://plurigent.com/topics/iphone-duo/safe-area)
2. **아이폰 듀오 안쪽 화면은 951×669pt(가로형)이다.** App Store Connect 스크린숏 규격이 2853×2007px(@3x)이고, 패널(2670×1878)로 축소해 그린다. 890×626으로 적은 자료는 패널 픽셀을 3으로 나눈 추정이라 틀렸다. [App Store 스크린숏 규격](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
3. **브라우저 폴더블 API는 크롬 계열만 정식 지원한다.** Device Posture는 크롬 132, Viewport Segments는 크롬 138(안드로이드·데스크톱)에서 나왔다. 사파리는 27.1 베타에서 플래그 뒤에만 있고, 파이어폭스는 구현이 없다. [chromestatus 세그먼트](https://chromestatus.com/feature/5170498990243840) · [chromestatus 자세](https://chromestatus.com/feature/5185813744975872) · [Interop 2027 제안](https://github.com/web-platform-tests/interop/issues/1439)
4. **평평하게 펼친 갤럭시 폴드는 세그먼트가 1개다.** 크롬은 접는 선이 `HALF_OPENED`일 때(반 접힘)나 물리 힌지일 때만 화면을 둘로 나눠 알려 준다. 접힘 커버 화면, 완전히 펼침, 화면 분할은 모두 `continuous` + 세그먼트 1개다. [크롬 소스](https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/android/java/src/org/chromium/content/browser/device_posture/DevicePosturePlatformProviderAndroid.java) · [Jetpack FoldingFeature](https://developer.android.com/reference/kotlin/androidx/window/layout/FoldingFeature)
5. **크롬 개발자 도구의 폴더블 프리셋 일부는 실기기와 다르다.** "Galaxy Z Fold 6"는 412×968 / 744×860이지만 실기기는 369×906 / 708×823이다. "Pixel 9 Pro Fold"는 412×922 / 836×842 @2.625이지만 실기기는 444×995 / 852×883 @2.4375다. 그래서 FoldLab은 실측치를 쓴다. [windowinsets.info 측정 데이터](https://github.com/easyhooon/windowinsets.info)
6. **크롬 탭과 앱 웹뷰는 안전 영역이 다르다.** 크롬 탭에서는 카메라 아래로 그리지 않고 폭을 줄인다(좌우 inset은 늘 0). 아래쪽은 크롬 135+ 엣지 투 엣지 동작을 따른다. 안드로이드 웹뷰(M136+, 실질적으로 140+)는 화면을 채우면 `viewport-fit`과 상관없이 시스템 바·카메라 영역을 안전 영역으로 준다. [크롬 edge-to-edge](https://developer.chrome.com/docs/css-ui/edge-to-edge) · [DisplayCutoutController](https://chromium.googlesource.com/chromium/src/+/HEAD/components/browser_ui/display_cutout/android/java/src/org/chromium/components/browser_ui/display_cutout/DisplayCutoutController.java)
7. **접는 선 위 조작 요소를 정량적으로 금지한 공식 기준은 없다.** 삼성·구글·애플 모두 "접는 선 가까이에 두지 말라"고만 한다. FoldLab은 반 접힘 ±24px(48dp 터치 대상의 절반), 펼침 ±12px, 아이폰 듀오는 시스템이 비우는 40pt 띠를 쓴다.
8. **폴더블 전용 자동 검사 도구는 아직 없다.** 크롬 개발자 도구는 수동 에뮬레이션만 하고, 실기기 클라우드는 접기/펴기만 지원한다(반 접힘·화면 분할·규칙 엔진 없음).

## 2. 기기 데이터

CSS px = 물리 px ÷ DPR이고, 크롬 안드로이드는 결과를 올림한다(`ui/android/view_android.cc`). 안드로이드 값은 실기기 측정(windowinsets.info, Remote Test Lab, Firebase Test Lab)과 삼성 공식 에뮬레이터 스킨을 우선했다.

| 기기 | 출시 | DPR | 커버(접힘) | 메인(펼침) | 접는 선 | 상태/제스처 | 비고 |
|---|---|---|---|---|---|---|---|
| iPhone Duo | 2026-10 | 3 | 466×678 | 951×669 (가로형) | 세로, x=475.5, 반 접힘 시 40pt 띠 | 오른쪽 막대 84 / 34 | 모서리 경첩 쪽 8·반대쪽 59pt, 안쪽 55pt. 다이내믹 아일랜드 위치는 추정 |
| Galaxy Z Fold8 | 2026-08 | 2.625 | 476×752 | 933×704 (4:3 가로형) | 세로, x=466.3 | 42·40 / 15 | 안쪽 펀치 홀 미보고 |
| Galaxy Z Fold8 Ultra | 2026-08 | 3.0 | 360×840 | 752×835 | 세로, x=376 | 38 / 15 | 480dpi로 바뀜 |
| Galaxy Z Fold7 | 2025-07 | 2.625 | 412×960 | 750×832 | 세로, x=375 | 42·34 / 15 | 안쪽 펀치 홀(566.9, 20.2) 미보고 |
| Galaxy Z Fold6 | 2024-07 | 2.625 | 369×906 | 708×823 | 세로, x=353.5 | 36 / 15 | 안쪽 UDC |
| Pixel 10 Pro Fold | 2025-10 | 2.4375 | 444×970 | 852×883 | 세로, x=425.9 | 62·66 / 24·32 | 390dpi, 안쪽 카메라 오른쪽 위 |
| Galaxy Z Flip8 | 2026-08 | 3.0 / 커버 2.375 | 400×442 | 360×840 | 가로, y=420 | 36 / 15 | 커버 카메라 섬 오른쪽 아래, 커버 모서리 위 5·아래 41 |
| Galaxy Z Flip7 | 2025-07 | 3.0 / 커버 2.625 | 362×400 | 360×840 | 가로, y=420 | 36 / 15 | 커버 카메라 섬 오른쪽 아래 |
| Galaxy Z Flip6 | 2024-07 | 3.0 / 커버 2.0(추정) | 360×374 | 360×880 | 가로, y=440 | 31 / 15 | 커버 카메라 모양 미확인 |
| Galaxy Z TriFold | 2025-12 | 2.625 / 메인 2.0 | 412×960 | 1080×792 (가로형) | x≈333, 715.5 (스킨에서 잰 추정) | 43·36 / 15 | 안드로이드는 x=540에 접는 선 하나만 보고 |
| Surface Duo 2 | 2021-10 | 2.5 | 538×757 | 1102×757 | 힌지 26px | 24 / 24 | 단종, 안드로이드 12L |
| Surface Duo | 2020-09 | 2.5 | 540×720 | 1114×720 | 힌지 34px | 24 / 24 | 단종, 개발자 도구 프리셋과 같음 |

추가로 알아 둘 점:

- **UA**: 크롬 110+ 안드로이드는 `Mozilla/5.0 (Linux; Android 10; K) … Chrome/<major>.0.0.0 Mobile Safari/537.36`으로 고정되고, 모델명은 UA Client Hints(`Sec-CH-UA-Model`)로만 보낸다. 아이폰 사파리는 iOS 26부터 OS 버전을 `18_6`으로 고정한다. [UA 축소](https://developer.chrome.com/blog/user-agent-reduction-android-model-and-version) · [iOS 26 UA](https://51degrees.com/blog/apple-ios26-safari26-user-agent-string-device-detection)
- **삼성 폴드 안쪽 펀치 홀**(Fold7·Fold8·Fold8 Ultra·TriFold)은 화면을 가리지만 안드로이드가 DisplayCutout으로 알려 주지 않는다. 그래서 `env(safe-area-inset-*)`가 0이다. FoldLab은 이런 카메라를 "안전 영역 미보고"로 표시하고 겹침만 검사한다.
- **트라이폴드**는 크롬의 "10인치·8GB 이상이면 데스크톱 사이트" 규칙에 걸릴 수 있다(미확인). [크롬 데스크톱 모드](https://developer.chrome.com/blog/desktop-mode)
- **플립 커버 화면**에서 크롬을 쓰려면 실험실 설정이 필요하고, 카메라 위쪽으로 레터박스될 가능성이 높다(추정). 플립8은 플렉스윈도우에서 삼성 인터넷이 바로 돈다. [Android Authority](https://www.androidauthority.com/galaxy-z-flip-8-cover-screen-apps-3688143/)
- 신뢰도가 낮아(DPR 추정) 카탈로그에서 뺀 기기: Motorola razr 2025/2026, razr ultra, Huawei Mate XT/XTs, Honor Magic V5, vivo X Fold5, OPPO Find N5. 필요하면 "기기 직접 만들기"로 추가한다.

## 3. 웹 플랫폼 API와 실제 기기 동작

### Viewport Segments API

- 구성: `window.viewport.segments`(`DOMRect[]`), CSS `@media (horizontal-viewport-segments: 2)` / `(vertical-viewport-segments: 2)`, `env(viewport-segment-{width,height,top,left,bottom,right} x y)`. 세그먼트가 2개 이상일 때만 env 변수가 정의된다. [CSS Viewport](https://drafts.csswg.org/css-viewport/) · [CSS Env](https://drafts.csswg.org/css-env-1/)
- `vertical` 디스플레이 기능은 좌우로 나뉜 `horizontal-viewport-segments: 2`가 되고, `horizontal`은 위아래로 나뉜 `vertical-viewport-segments: 2`가 된다.
- 크롬은 접는 선을 **하나만** 다룬다. CDP도 두 번째 기능을 넣으면 "Only one display feature is supported"로 거부한다.
- 테이블탑 자세에서 크롬 상단 툴바가 보이면 첫 세그먼트 높이가 툴바 높이만큼 줄어든다. FoldLab은 디스플레이 기능 위치를 뷰포트 기준으로 계산해 이를 반영한다.
- 옛 문법(`screen-spanning`, `env(fold-*)`, `getWindowSegments()`)은 M96에서 바뀌었다. `visualViewport.segments`는 M130에 `window.viewport`로 옮겨 갔다.

### Device Posture API

- `navigator.devicePosture.type`(`continuous` | `folded`), `change` 이벤트, CSS `@media (device-posture: folded)`. **보안 컨텍스트(https·localhost)에서만** JS 객체가 있다. [W3C CR](https://www.w3.org/TR/device-posture/)
- 실제 갤럭시 폴드·플립에서 `folded`는 반 접혔고 크롬 창이 접는 선에 걸칠 때만 나온다.

### 안전 영역(safe-area-inset)

| 환경 | 위 | 좌우(카메라) | 아래 | 근거 |
|---|---|---|---|---|
| 크롬 탭(안드로이드) | 0 | 0, 카메라 쪽은 폭을 줄임 | 처음엔 0(chin), 스크롤해 chin이 사라지면 내비게이션 바 높이. `viewport-fit=cover`면 처음부터 바 높이 | [edge-to-edge](https://developer.chrome.com/docs/css-ui/edge-to-edge), `DisplayCutoutController.java` |
| 전체 화면 / `display: fullscreen` PWA + cover | 카메라 | 카메라 | 카메라 | [display_cutout.md](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/ui/android/display_cutout.md) |
| `standalone` PWA | 크롬 탭과 같음 | | | |
| 안드로이드 웹뷰(140+), 화면을 채울 때 | 상태 표시줄+카메라 | 카메라 | 내비게이션 바 | viewport-fit과 무관. [CL 6295663](https://chromium-review.googlesource.com/c/chromium/src/+/6295663) |
| iOS 사파리 | 0 | cover일 때만 노치·아일랜드 | 아래 탭 바 위가 bottom 0 | [WebKit](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) · [bug 297779](https://bugs.webkit.org/show_bug.cgi?id=297779) |

`env(safe-area-max-inset-*)`는 크롬 135+에서 동적 inset의 최댓값이다. 고정 하단 바는 `safe-area-max-inset-bottom` 패턴을 쓰는 것이 권장된다.

## 4. 헤드리스 크로미움 에뮬레이션(CDP)

| 명령 | 도입 | FoldLab에서 쓰는 방법 |
|---|---|---|
| `Emulation.setDeviceMetricsOverride` + `displayFeature` | M86(현재 deprecated) | **화면 분할은 이 인자로만 반영된다**(아래 참고) |
| `Emulation.setDeviceMetricsOverride` + `devicePosture` | M121(deprecated) | 크롬 121~148에서 자세가 되돌아가지 않게 함께 넘긴다 |
| `Emulation.setDevicePostureOverride` | M125 | JS `navigator.devicePosture`까지 바꾼다. 크기를 바꾼 **뒤에** 건다 |
| `Emulation.setDisplayFeaturesOverride` | M136 | 기기 에뮬레이션 중에는 **효과가 없다** |
| `Emulation.setSafeAreaInsetsOverride` | M136 | 8개 값을 모두 넘긴다(빠진 값은 0이 아니라 "정의되지 않음"이 된다) |
| `Emulation.setPageScaleFactor` | — | 크기를 바꾼 뒤 페이지 배율을 초기 배율로 되돌린다 |
| `Page.startScreencast`, `Input.dispatchTouchEvent` | — | 라이브 화면과 터치 입력 |

직접 확인하거나 소스로 확인한 함정:

- **`setDisplayFeaturesOverride`는 무시된다.** 값이 실제 뷰 크기 기준으로 계산되는데, 기기 에뮬레이션 중에는 `ScreenMetricsEmulator`가 세그먼트를 덮어쓴다. 크로미움 141에서 직접 확인했고 HEAD 소스도 같다. 크롬 개발자 도구도 deprecated 인자를 쓴다. ([screen_metrics_emulator.cc](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/frame/screen_metrics_emulator.cc))
- **크롬 121~148은 크기를 바꿀 때마다 자세를 `continuous`로 되돌린다.** `setDeviceMetricsOverride`에 `devicePosture`를 함께 넘겨야 한다. M149에서 고쳐졌다. ([CL 7763896](https://chromium-review.googlesource.com/c/chromium/src/+/7763896))
- **에뮬레이션 크기를 바꾸면 이전 배율이 남는다.** 예: 412px에서 가로로 넘친 페이지를 750px로 바꾸면 1.74배 확대된 채 남는다(직접 확인). FoldLab은 크기를 바꿀 때 viewport 메타의 초기 배율로 되돌린다.
- **Playwright는 컨텍스트에 viewport가 있으면 자기 `setDeviceMetricsOverride`를 다시 보내 세그먼트를 지운다.** 그래서 `viewport: null`로 만들고 CDP로 직접 에뮬레이션한다.
- **CSS·JS 사용 여부 검사 시 주의:** CSS 중첩을 지원하는 크롬에서는 일반 스타일 규칙도 `cssRules`를 가진다. 선언부(`style.cssText`)를 따로 봐야 `env(safe-area-inset-*)` 사용을 놓치지 않는다(직접 확인).

## 5. 검사 규칙과 근거

| 규칙 | 기준 | 심각도 | 근거 |
|---|---|---|---|
| 접는 선 위 조작 요소 | 반 접힘: ±24px 띠에 걸리면 주의, 선이 요소를 가르면 높음. 펼침: 선이 가르면 주의 | 자세별 | [삼성 One UI](https://developer.samsung.com/one-ui/foldable-and-largescreen/foldable-excl-flex.html), [Android fold-aware](https://developer.android.com/develop/adaptive-apps/guides/foldables/make-your-app-fold-aware), [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo) |
| 힌지에 가려짐 | 물리 힌지 마스크와 겹치면 | 높음 | [Microsoft dual-screen](https://learn.microsoft.com/en-us/dual-screen/introduction) |
| 접는 선을 가로지르는 텍스트·미디어 | 반 접힘에서 양쪽으로 8px(텍스트)·24px(미디어) 이상 | 주의 | Android: 접는 선 위 텍스트는 읽기 어렵다 |
| 대화상자 분할 | 양쪽으로 24px 이상 | 반 접힘 높음 / 펼침 참고 | [Android](https://developer.android.com/guide/topics/large-screens/learn-about-foldables) |
| 카메라·상태 표시줄·제스처 영역 겹침 | 조작 요소 높음, 텍스트 주의 | 높음/주의 | [WebKit safe area](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) |
| 가로 스크롤 | `scrollWidth > clientWidth`. 화면이 320px 미만이면 주의로 낮춤 | 높음 | [WCAG 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) |
| 작은 터치 영역 | 24×24 미만이고 24px 원 간격 예외 불충족 | 주의 | [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) |
| 다른 요소에 가려짐 | 고정 요소에 가려 스크롤해도 누를 수 없음 | 높음 | [WCAG 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) |
| 너무 긴 줄 | 한 줄 라틴 80자·한중일 40자 초과 참고, 120·60자 초과 주의 | 참고/주의 | [WCAG 1.4.8](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html) |
| 넓은 화면 미활용 | 600px 이상에서 콘텐츠 폭이 55% 미만 | 참고 | [창 크기 등급](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes) |
| 뷰포트 메타 누락 / 확대 막힘 | `width=device-width` 없음 / `user-scalable=no`·`maximum-scale<2` | 높음 / 주의 | [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport), [axe meta-viewport](https://dequeuniversity.com/rules/axe/4.10/meta-viewport) |
| 고정 요소 과점유 | 고정 요소가 화면의 30% 초과(높이 480 미만이면 주의, 50% 초과면 높음) | 참고~높음 | [Better Ads 30%](https://www.betterads.org/mobile-large-sticky-ad/) |
| 화면 방향 강요 | 화면 80% 이상을 덮는 "회전해 주세요" 안내 | 높음 | [WCAG 1.3.4](https://www.w3.org/WAI/WCAG22/Understanding/orientation.html) |
| 스크롤 안 되는 오버레이 | 고정 영역 내용이 화면 밖으로 넘치는데 스크롤 컨테이너가 없음 | 높음 | [web.dev 뷰포트 단위](https://web.dev/blog/viewport-units) |
| 스크롤 시 하단 가림 | 크롬 탭에서 아래에 붙은 고정 요소 + safe-area 미사용 | 주의 | [크롬 edge-to-edge](https://developer.chrome.com/docs/css-ui/edge-to-edge) |
| 자세 전환 시 상태 유실 | 새로 로드됨·입력값 유실은 높음, 스크롤 위치·재생 상태 유실은 주의 | 높음/주의 | [Android 앱 품질 Tier 3](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-3) |
| 안전 영역 미사용 / 레터박스 | cover인데 `env(safe-area-inset-*)` 없음 / cover 아님 | 주의 / 참고 | |
| 접힘 대응 코드 없음 | 두 세그먼트 자세에서 viewport-segments·device-posture 사용 흔적 없음 | 참고 | |

## 6. 기존 도구와의 차이

| 도구 | 폴더블 지원 | 한계 |
|---|---|---|
| 크롬 개발자 도구 | Fold5/6, Pixel 9 Pro Fold, Surface Duo, 자세 드롭다운 | 수동 조작만 된다. "Continuous"는 커버 화면을 뜻해 평평하게 펼친 안쪽 화면을 재현할 수 없다. 일부 프리셋 값이 틀리고 검사 기능이 없다 |
| Polypane / Responsively / Sizzy | 여러 화면 동시 보기, 일부 정적 프리셋 | 힌지·세그먼트·자세 없음 |
| Playwright 기기 목록 | Fold6/7, Flip6/7(1.61+) | 자세·세그먼트·카메라 정보 없음 |
| BrowserStack / TestMu(LambdaTest) | 실기기 Fold·Flip에서 접기/펴기 | 반 접힘·화면 분할·자동 규칙 없음 |
| Samsung Remote Test Lab | 실기기 원격 조작(Fold8·Flip8 포함) | 수동. 값 보정에는 유용 |
| Android 에뮬레이터 | `adb emu posture`로 진짜 WindowManager 동작 | 웹 검사 기능 없음 |

FoldLab이 채우는 빈자리:

- 자세 매트릭스 자동화
- 자세에 따라 심각도가 바뀌는 접힘 규칙
- 자세 전환 연속성 검사
- 실측 기반 기기 데이터
- PR·Jira용 비교 시트
- 한국어 UI와 한중일 줄 길이 기준

## 7. 한계와 실기기 확인이 필요한 것

- **렌더링 엔진은 크로미움(Blink)이다.** 아이폰 듀오는 화면 크기·UA·안전 영역만 흉내 내며 WebKit 고유 동작은 재현하지 않는다. 삼성 인터넷, 웨일 등 다른 브라우저의 UI도 크롬 기준으로 그린다.
- **동적 툴바를 재현하지 않는다.** 헤드리스에는 줄었다 늘어나는 주소창이 없어 `svh`와 `lvh`가 같다.
- **"화면 크기" 설정에 따라 DPR이 바뀐다.** 삼성 화면 줌을 바꾸면 CSS 폭이 달라진다. 카탈로그 값은 기본 설정 기준이다.
- **실기기로 확인할 것:**
  - 아이폰 듀오 사파리의 실제 뷰포트·안전 영역·주소창 위치
  - 트라이폴드가 세그먼트를 몇 개 알려 주는지
  - 플립 커버 화면에서 크롬·삼성 인터넷의 레터박스
  - 폴드 안쪽 화면의 크롬 엣지 투 엣지 chin 동작
  - `HALF_OPENED`로 바뀌는 각도

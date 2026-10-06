// WebKit 페이지에 문서 시작 때 심는 안전 영역 흉내(IIFE로 묶는다)
import { installSafeAreaShim } from './safearea';

installSafeAreaShim();

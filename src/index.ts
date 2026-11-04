/** Package entry: the default export is the `WorldDefinition`. */
import { SCREEN_DIARY } from './definition.ts';

export default SCREEN_DIARY;
export { SCREEN_DIARY, screenDiaryDefinition, type DiaryAssembly } from './definition.ts';
export { ScreenDiaryWorld, SCREEN_DIARY_ID, SCREEN_DIARY_TOOL_DECLS } from './world.ts';
export { DIARY_DEFAULTS, diaryConfigGroup, diaryPanelText, type DiaryConfig } from './config.ts';
export { DiaryBook, localParts, entryOf, type DiaryEntry } from './book.ts';

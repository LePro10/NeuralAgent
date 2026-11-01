// Barrel for the marketing foundation. Import from "../ui" (sections) or "./site/ui" (pages).
export { ActivityMark, ACTIVITY_LABEL, type ActivityKind } from "./ActivityMark";
export { AgentGlyph } from "./AgentGlyph";
export { Button, LinkButton } from "./Button";
export { CopyCommand } from "./CopyCommand";
export { Fold } from "./Fold";
export { Footer } from "./Footer";
export { GitHubIcon, Icon, ICON_SIZE, type IconSize } from "./Icon";
export { Kbd } from "./Kbd";
export { Nav } from "./Nav";
export { PaneField } from "./PaneField";
export { PaneTitle } from "./PaneTitle";
export { Reveal, SlotLines, type RevealKind } from "./Reveal";
export { Guides, Section } from "./Section";
export { SendToComputer } from "./SendToComputer";
export { initPage, scrollToHash } from "./page";
export { detectOs, isMobileOs, OS_LABEL, shortDate, useRelease, type Cta, type Latest, type Os, type ReleaseStatus } from "./release";
export {
  prefersReducedMotion, useActiveSection, useCopy, useFinePointer, useInView, useIsPhone, useMedia, useMoreToRight, usePageVisible, useReducedMotion, useScrollProgress,
} from "./hooks";

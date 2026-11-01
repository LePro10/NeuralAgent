// The six chapters of the story. Copy uses only facts from research-local/site-overhaul/site-audit.md Part B.
// `scene` is what the chapter plays in the shared world; `poster` is the static image for phones and the
// first paint (public/demo/{desk,phone}-<poster>.webp); `phone` says whether the phone joins the stage.
import type { DemoScene } from "../../demo/api";
import type { ActivityKind } from "../ui";

export interface Chapter {
  id: string;
  scene: DemoScene;
  title: string;
  /** Paragraphs. `code` spans use backticks. */
  body: string[];
  /** The short copy of the stacked (phone) layout: it sits beside a poster of the PHONE app, so it talks about the phone. */
  lede: string;
  poster: string;
  phone: boolean;
  /** One mono line under the copy: what to try in the live window. */
  try: string;
  /** Short label for the progress index. */
  short: string;
  /** The activity mark the poster shows (what the agent in the picture is doing). */
  mark: ActivityKind;
  /** Last path segment of the window title. */
  where: string;
  /** Alt text of the posters. */
  alt: { desk: string; phone: string };
}

export const CHAPTERS: readonly Chapter[] = [
  {
    id: "grid",
    scene: "grid",
    title: "Side by side.",
    body: [
      "Claude Code, Codex, OpenCode and Gemini CLI work in the same project, each in its own terminal pane. Layouts are saved per workspace and come back when you reopen the app.",
    ],
    lede: "Pick any agent of any project and watch it work. It is the same app and the same agents as on your computer, on your phone.",
    poster: "grid",
    phone: false,
    try: "Type into any pane.",
    short: "side by side",
    mark: "working",
    where: "billing-api",
    alt: { desk: "The NeuralAgent desktop app: four coding agents working side by side in a grid of terminal panes.", phone: "The NeuralAgent phone app showing a Claude Code agent at work." },
  },
  {
    id: "permission",
    scene: "permission",
    title: "It waits for you.",
    body: [
      "When an agent needs a decision, its pane says so: a pulsing accent dot and a permission card in Claude's own look. The agent stays put until you answer. The sidebar and the Agents list show who is waiting.",
    ],
    lede: "When an agent needs a decision, the phone shows the question with Allow and Deny. The agent waits until you answer.",
    poster: "permission",
    phone: false,
    try: "Allow or deny the question.",
    short: "it waits",
    mark: "waiting",
    where: "billing-api",
    alt: { desk: "The desktop app with Claude Code asking for permission to run pnpm test.", phone: "The phone app with the same permission question and Allow and Deny buttons." },
  },
  {
    id: "phone",
    scene: "phone",
    title: "Your phone is the remote.",
    body: [
      "The same app runs on your phone and reaches your computer through an end-to-end encrypted relay. A push notification says who is waiting. Allow it there and the agent carries on at your desk.",
    ],
    lede: "The same app runs on your phone and reaches your computer through an end-to-end encrypted relay. Allow a question there and the agent carries on at your desk.",
    poster: "agents",
    phone: true,
    try: "Answer the question on the phone.",
    short: "phone remote",
    mark: "done",
    where: "billing-api",
    alt: { desk: "The desktop app next to the phone, where the waiting agent is listed under Needs you.", phone: "The phone app's Agents inbox with an agent waiting under Needs you." },
  },
  {
    id: "neural",
    scene: "neural",
    title: "Talk to Neural.",
    body: [
      "Ask what your agents are doing, or tell it to start one. Neural starts agents in a folder with a prompt, answers their questions, runs the tests when one finishes and tells you the result.",
      "Talk or type. The model is a provider you choose; its key stays in your system keychain.",
    ],
    lede: "Ask what your agents are doing, or tell Neural to start one. Talk or type; the model is a provider you choose.",
    poster: "neural",
    phone: true,
    try: "Ask “what are my agents doing”.",
    short: "neural",
    mark: "working",
    where: "neural",
    alt: { desk: "The Neural page of the desktop app: a conversation about what the agents are doing.", phone: "The Neural tab of the phone app with a conversation and a question waiting." },
  },
  {
    id: "team",
    scene: "team",
    title: "Hand it to a team.",
    body: [
      "Give one goal to several agents. In a race, two to four agents try the same job in separate worktrees, Neural compares them and you keep the best. Build and review pairs a builder with a reviewer until the reviewer approves.",
    ],
    lede: "Give one goal to several agents. In a race Neural compares their attempts and you keep the best.",
    poster: "team",
    phone: false,
    try: "Pick a winner.",
    short: "teams",
    mark: "waiting",
    where: "teams",
    alt: { desk: "The Teams page: three agents racing on one goal, waiting for you to pick one.", phone: "The Teams page on the phone: three attempts at one goal." },
  },
  {
    id: "files",
    scene: "files",
    title: "Files, changes, history.",
    body: [
      "Every project has its files, its git status and the diff of what an agent changed. Claude Code gets a readable chat with real diffs next to the terminal, and past conversations can be searched and resumed. On the desktop and on your phone.",
    ],
    lede: "Every project has its files, its git status and the diff of what an agent changed, also on your phone.",
    poster: "files",
    phone: false,
    try: "Open a changed file.",
    short: "files",
    mark: "idle",
    where: "billing-api/changes",
    alt: { desk: "The desktop app showing the changed files of a project and the diff an agent made.", phone: "The Files page of the phone app with git changes marked." },
  },
];

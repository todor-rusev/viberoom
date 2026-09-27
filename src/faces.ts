// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export type FaceFor = "vibemate" | "room";

export interface FacePicture {
  id: string;
  for: FaceFor;
  group: string;
  label: string;
  emoji: string;
}

export const FACE_GROUPS: readonly { id: string; for: FaceFor; label: string }[] = [
  { id: "suited", for: "vibemate", label: "Suited animals" },
  { id: "robots", for: "vibemate", label: "Robots" },
  { id: "people", for: "vibemate", label: "People" },
  { id: "cartoon", for: "vibemate", label: "Cartoon animals" },
  { id: "rooms", for: "room", label: "Rooms" },
];

const v = (group: string, id: string, label: string, emoji: string): FacePicture => ({ id, for: "vibemate", group, label, emoji });
const r = (id: string, label: string, emoji: string): FacePicture => ({ id, for: "room", group: "rooms", label, emoji });

export const FACES: readonly FacePicture[] = [
  v("suited", "raccoon", "Raccoon", "🦝"), v("suited", "crow", "Crow in a hat", "🐦"), v("suited", "wolf", "Wolf", "🐺"),
  v("suited", "tiger", "Tiger", "🐯"), v("suited", "falcon", "Falcon", "🦅"), v("suited", "lion", "Lion", "🦁"),
  v("suited", "cat", "Cat in glasses", "🐱"), v("suited", "owl", "Owl", "🦉"), v("suited", "fox", "Fox", "🦊"),
  v("robots", "robot-blue", "Blue robot", "🤖"), v("robots", "robot-waving", "Waving robot", "🤖"), v("robots", "robot-shield", "Guard robot", "🤖"),
  v("robots", "robot-dark", "Dark robot", "🤖"), v("robots", "robot-butler", "Butler robot", "🤖"), v("robots", "robot-scholar", "Scholar robot", "🤖"),
  v("robots", "robot-yellow", "Yellow robot", "🤖"), v("robots", "robot-orange", "Robot with headphones", "🤖"), v("robots", "robot-painter", "Painter robot", "🤖"),
  v("people", "lawyer", "Lawyer", "🧑‍⚖️"), v("people", "detective", "Detective", "🕵️"), v("people", "reporter", "Reporter", "🎤"),
  v("people", "designer", "Designer", "🧑‍🎨"), v("people", "developer", "Developer", "🧑‍💻"), v("people", "assistant", "Assistant", "🧑‍💼"),
  v("people", "architect", "Architect", "📐"), v("people", "mechanic", "Mechanic", "🧑‍🔧"), v("people", "professor", "Professor", "🧑‍🏫"),
  v("people", "doctor", "Doctor", "🧑‍⚕️"),
  v("cartoon", "bulldog", "Bulldog", "🐶"), v("cartoon", "owl-bowtie", "Owl in a bow tie", "🦉"), v("cartoon", "frog", "Frog in a beret", "🐸"),
  v("cartoon", "cat-diva", "Diva cat", "😼"), v("cartoon", "llama", "Llama", "🦙"), v("cartoon", "fox-scarf", "Fox in a scarf", "🦊"),
  v("cartoon", "monkey", "Monkey", "🐵"), v("cartoon", "raccoon-hoodie", "Raccoon in a hoodie", "🦝"), v("cartoon", "pig", "Pig", "🐷"),
  v("cartoon", "penguin", "Penguin", "🐧"),
  r("ideas", "Ideas", "💡"), r("learning", "Learning", "🎓"), r("music", "Music", "🎵"), r("security", "Security", "🔒"),
  r("movies", "Movies", "🎬"), r("coding-desk", "Coding desk", "💻"), r("infrastructure", "Infrastructure", "🗄️"), r("shopping", "Shopping", "🛍️"),
  r("writing", "Writing", "✍️"), r("command-center", "Command center", "🛰️"), r("design", "Design", "🎨"), r("travel", "Travel", "🌍"),
  r("analytics", "Analytics", "📊"), r("health", "Health", "💪"), r("lounge", "Lounge", "🛋️"), r("finance", "Finance", "💰"),
  r("archive", "Archive", "📚"), r("laptop", "Laptop", "💻"), r("debugging", "Debugging", "🐞"), r("games", "Games", "🎮"),
  r("agents", "Agents", "🤖"), r("growth", "Growth", "🚀"), r("automation", "Automation", "⚙️"), r("science", "Science", "🔬"),
  r("cooking", "Cooking", "🍜"), r("code", "Code", "⌨️"),
];

export const PICTURE = /^pic:([a-z][a-z0-9-]{1,31})$/;
export const FACE_TEXT_MAX = 8;

const byId = new Map(FACES.map((face) => [face.id, face]));
export const facePicture = (value: string | null | undefined): FacePicture | undefined => {
  const m = typeof value === "string" ? PICTURE.exec(value) : null;
  return m ? byId.get(m[1]) : undefined;
};

export function cleanFace(value: unknown, kind: FaceFor): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text.startsWith("pic:")) return text.slice(0, FACE_TEXT_MAX);
  const picture = facePicture(text);
  if (!picture) throw new Error(`"${text}" is not a picture viberoom has`);
  if (picture.for !== kind) throw new Error(`"${text}" is a picture for a ${picture.for}, not for a ${kind}`);
  return text;
}

export const faceText = (value: string | null | undefined): string => facePicture(value)?.emoji ?? (value ?? "");

export function freshFace(kind: FaceFor, taken: Iterable<string | null | undefined>, random: () => number = Math.random): string {
  const used = new Set([...taken].map((face) => facePicture(face)?.id).filter(Boolean));
  const all = FACES.filter((face) => face.for === kind);
  const free = all.filter((face) => !used.has(face.id));
  const pool = free.length ? free : all;
  return `pic:${pool[Math.floor(random() * pool.length)].id}`;
}

export const facesView = () => ({ groups: FACE_GROUPS, faces: FACES.map(({ id, for: kind, group, label }) => ({ id, for: kind, group, label, url: `/faces/${id}.webp` })) });

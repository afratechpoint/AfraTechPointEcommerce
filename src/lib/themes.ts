export const THEMES = {
  midnight: {
    id: "midnight",
    name: "Midnight Pro",
    primary: "#000000",
    text: "#ffffff",
    hover: "#1f2937",
    accent: "#374151",
  },
} as const;

export type ThemeId = keyof typeof THEMES;

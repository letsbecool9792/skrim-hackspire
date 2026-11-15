import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];
const KEY = "skrim-theme";
const LABEL: Record<Theme, string> = { system: "Theme: follows the system", light: "Theme: light", dark: "Theme: dark" };

function read(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

/**
 * Light, dark, or the system's choice: sets data-theme on <html>, which
 * design/tokens.css reads. The choice is a per-browser convenience; without
 * storage it simply starts from the system again.
 */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // Storage refused: the choice lasts until the page closes.
    }
  }, [theme]);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <button
      type="button"
      className="theme-switch"
      onClick={() => setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!)}
      title={`${LABEL[theme]}. Click to change.`}
      aria-label={`${LABEL[theme]}. Click to change.`}
    >
      <Icon className="icon" size={16} aria-hidden="true" />
    </button>
  );
}

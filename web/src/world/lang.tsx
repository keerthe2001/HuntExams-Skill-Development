// Languages: English now; Tamil and Hindi share the same URLs under /ta and /hi and fall back
// to English text until their translations are added to STRINGS (and the lesson content).
import { useLocation, useNavigate } from "react-router";

export type Lang = "en" | "ta" | "hi";
export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "EN" }, { code: "ta", label: "தமிழ்" }, { code: "hi", label: "हिं" },
];
export const PUBLISHED: Lang[] = ["en"];

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {},
  ta: { soon: "தமிழ் பதிப்பு விரைவில் வருகிறது. இப்போது ஆங்கிலத்தில் காட்டுகிறோம்." },
  hi: { soon: "हिन्दी संस्करण जल्द आ रहा है। अभी अंग्रेज़ी में दिखा रहे हैं।" },
};

export function langOf(pathname: string): Lang {
  const seg = pathname.split("/")[1];
  return seg === "ta" || seg === "hi" ? seg : "en";
}

export function useLang() {
  const { pathname } = useLocation();
  const lang = langOf(pathname);
  const to = (path: string) => (lang === "en" ? path : `/${lang}${path === "/" ? "" : path}`);
  const t = (key: string, fallback: string) => STRINGS[lang][key] ?? fallback;
  return { lang, to, t, published: PUBLISHED.includes(lang) };
}

export function LangSwitch() {
  const { pathname, search } = useLocation();
  const nav = useNavigate();
  const lang = langOf(pathname);
  const bare = lang === "en" ? pathname : pathname.slice(lang.length + 1) || "/";
  const go = (code: Lang) => {
    try { localStorage.setItem("hx-lang", code); } catch { /* private mode */ }
    nav((code === "en" ? bare : `/${code}${bare === "/" ? "" : bare}`) + search);
  };
  return (
    <div className="w-lang" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l.code} type="button" aria-pressed={lang === l.code} onClick={() => go(l.code)}>{l.label}</button>
      ))}
    </div>
  );
}

export function SoonBanner() {
  const { published, t } = useLang();
  if (published) return null;
  return <div className="w-soon" role="status">{t("soon", "")}</div>;
}

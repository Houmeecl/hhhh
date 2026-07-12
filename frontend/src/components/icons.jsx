// Set de íconos SVG propios (trazo, currentColor). Reemplazan los emoji para una
// apariencia consistente entre sistemas operativos. Uso: <Icon.Cloud size={20} />
const base = (size, children, extra = {}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...extra}>
    {children}
  </svg>
);

export const Icon = {
  Cloud: ({ size = 22 }) => base(size, <>
    <path d="M17 18a4 4 0 0 0 .5-7.97 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 6 18h11Z" />
    <path d="M12 13v-4M12 9l-2 2M12 9l2 2" />
  </>),
  Upload: ({ size = 22 }) => base(size, <>
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    <path d="M12 4v12M12 4 8 8M12 4l4 4" />
  </>),
  Doc: ({ size = 22 }) => base(size, <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </>),
  Cog: ({ size = 22 }) => base(size, <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
  </>),
  Tag: ({ size = 22 }) => base(size, <>
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l6.4 6.4a2 2 0 0 1 0 2.4Z" />
    <circle cx="8.5" cy="8.5" r="1.3" />
  </>),
  Check: ({ size = 22 }) => base(size, <path d="M20 6 9 17l-5-5" />),
  CheckCircle: ({ size = 22 }) => base(size, <>
    <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.3 2.3L16 9" />
  </>),
  Building: ({ size = 22 }) => base(size, <>
    <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 21V9h3a1 1 0 0 1 1 1v10" />
    <path d="M8 7h2M8 11h2M8 15h2" /><path d="M2 21h20" />
  </>),
  Chart: ({ size = 22 }) => base(size, <>
    <path d="M3 3v18h18" /><path d="M7 15v3M12 10v8M17 6v12" />
  </>),
  Target: ({ size = 22 }) => base(size, <>
    <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" />
  </>),
  Plug: ({ size = 22 }) => base(size, <>
    <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5" />
  </>),
  Users: ({ size = 22 }) => base(size, <>
    <circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 5.5a3 3 0 0 1 0 5M21 20a6 6 0 0 0-4-5.6" />
  </>),
  List: ({ size = 22 }) => base(size, <>
    <path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </>),
  Alert: ({ size = 22 }) => base(size, <>
    <path d="M12 3 2 20h20L12 3Z" /><path d="M12 9v5M12 17.5h.01" />
  </>),
  Sparkles: ({ size = 22 }) => base(size, <>
    <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z" />
    <path d="M18 15l.7 1.8L20.5 17.5l-1.8.7L18 20l-.7-1.8L15.5 17.5l1.8-.7L18 15Z" />
  </>),
  Qr: ({ size = 22 }) => base(size, <>
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M20 14v.01M14 20h.01M20 20v-3h.01M17 20h.01" />
  </>),
  Calendar: ({ size = 22 }) => base(size, <>
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" />
  </>),
  Info: ({ size = 22 }) => base(size, <>
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
  </>),
  Shield: ({ size = 22 }) => base(size, <>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" />
  </>),
  Leaf: ({ size = 22 }) => base(size, <>
    <path d="M20 4S8 4 5 12c-1.5 4 1 7 5 7 8 0 10-11 10-15Z" /><path d="M5 19S8 12 15 9" />
  </>),
  Download: ({ size = 22 }) => base(size, <>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    <path d="M12 3v12M12 15l-4-4M12 15l4-4" />
  </>),
  Logout: ({ size = 22 }) => base(size, <>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 12H3M3 12l3-3M3 12l3 3" />
  </>),
  Search: ({ size = 22 }) => base(size, <>
    <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
  </>),
  ArrowRight: ({ size = 22 }) => base(size, <path d="M5 12h14M13 6l6 6-6 6" />),
};

export default Icon;

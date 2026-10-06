# React + Vite

## Bookclubr App Store URLs

- Marketing URL: https://www.marcustaylor.org/bookclub
- Support URL: https://www.marcustaylor.org/bookclub/support
- Privacy Policy URL: https://www.marcustaylor.org/bookclub/privacy

The marketing page describes Bookclubr's reading and club features. The support
page provides troubleshooting, account deletion guidance, and a direct email
contact without requiring sign-in. The privacy policy covers app and guest data,
service providers, permissions, visibility, retention, and deletion. All three
are public routes served by the existing Vercel SPA rewrite. Guest voting remains
at `/bookclub/v/:code`.

## Bookclubr guest voting

`/bookclub` is the public landing page. An organizer-generated URL at `/bookclub/v/<code>` opens the ranked ballot in the browser. The React routes rely on the existing Vercel rewrite in `vercel.json` for direct visits.

The Supabase project URL and publishable key are in `src/pages/bookclubConfig.js`. This key is intentionally public; the database migration in the Bookclubr app repository grants anonymous callers only token-scoped guest vote RPCs. Do not put a Supabase secret or service-role key in this file.

Vercel Analytics is disabled on guest vote routes so ballot links are not recorded as analytics page paths. Browser local storage supplies a stable ballot ID for edits. It does not prevent someone from voting again in another browser.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

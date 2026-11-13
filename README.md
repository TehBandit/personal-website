# React + Vite

## Homepage Instagram feed

The homepage embeds the public Juicer feed `artworkbymarcus`, with one post per
page. A local wrapper at `public/embeds/instagram.html` runs Juicer's standard
embed in an iframe, keeping its styles and scripts separate from the React app.
Both social cards use a 16:9 media area, with Instagram images cropped to fill.
No Juicer API key or Vercel environment variable is required.

Keep the Instagram source connected in Juicer so new posts sync on the account's
plan schedule. For a single latest-post card, set **Templates → Posts Per Page**
to **1** and **Pagination** to **None** in Juicer. The wrapper styles the feed as
an image-only card; its heading links directly to the Instagram profile.

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

Guest nomination and ballot forms require a name, mark it with a red asterisk, and disable submission until it is filled in. The backend returns `my_name` for the current browser and vote; the ballot reuses that saved name in a read-only field. New ballot requests include `p_name`. Apply the Bookclubr app repository's `202610290001` and `202610290002` migrations before deploying this UI; the older ballot endpoint remains compatible during rollout.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Blog publishing and SEO

- [iOS Screen Time API debugging guide](https://www.marcustaylor.org/blog/ios-screen-time-timed-access) covers the shields, timers, authorization, and persistence fixes in Due or Die.
- Blog posts continue to use the existing JSX metadata/component format and shared page layout. Optional `seoTitle`, `author`, `modified`, and `socialImage` fields supply search and sharing metadata.
- The normal deployment build runs `postbuild` to pre-render `/blog` and each public post using the same React application. The browser hydrates those pages; other routes retain their current client rendering. No runtime server or new dependency is required.
- Canonical URLs, Open Graph/Twitter tags, and JSON-LD share one metadata helper. Related-post links provide internal discovery. `sitemap.xml` is generated from the current public post list, and `robots.txt` advertises it while excluding API, OAuth, and guest-voting routes.
- Run `npm run test:seo` for metadata escaping, dates, canonical URLs, sitemap coverage, production-component static rendering, internal links, and social image checks. The publishing CI runs these checks before its normal production build.

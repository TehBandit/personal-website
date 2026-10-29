# Cutroom Instagram authorization callback

The standalone file `public/oauth/instagram-callback.html` is intended to be served at:

```text
https://www.marcustaylor.org/oauth/instagram-callback.html
```

The site's apex domain currently redirects to `www.marcustaylor.org`. Register the canonical `www` address exactly in both Meta's Instagram Login **Valid OAuth Redirect URIs** and Cutroom's **Analytics → Instagram → Registered redirect URL** field. Deploy and verify the page before starting a real connection.

The callback is a static instruction page, independent of the React application. It has no JavaScript, forms, remote assets, app analytics, or token-exchange backend. Hosting still receives the callback request and its authorization-code query string. Client secrets and access/refresh tokens stay in local Cutroom; do not add them to this repository or Vercel environment variables for this page.

After Instagram returns here, copy the full browser address into Cutroom's masked **Returned redirect address** field and choose **Complete connection** within 15 minutes. Cutroom validates the saved state and exchanges the code locally. Loading this page alone does not establish that authorization succeeded.

`vercel.json` applies no-store, no-referrer, noindex, and restrictive content-policy headers only to this path. Its `.html` extension bypasses the site's existing SPA catch-all rewrite. Vite copies the static file into `dist/oauth/instagram-callback.html` during `npm run build`; deploy using the site's normal Vercel workflow.

Verify the live callback with a query-free request before using it: it should return HTTP 200 directly on the canonical host, display **Finish connecting in Cutroom**, and include the configured headers. Then check a real Meta authorization through Cutroom. Google and TikTok Desktop continue using local callbacks.

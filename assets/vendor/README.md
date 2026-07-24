# Vendored browser dependencies

- `supabase-js-2.108.2.js`: browser ESM bundle built from
  `@supabase/supabase-js@2.108.2` and its pinned Supabase dependencies.
- Source: <https://github.com/supabase/supabase-js>
- License: MIT. The upstream package license is available at
  <https://github.com/supabase/supabase-js/blob/v2.108.2/LICENSE>.

The version is intentionally pinned and served from the same origin so that an
unversioned runtime CDN update cannot execute in an authenticated page. Review
upstream release notes and rebuild this file intentionally when upgrading.

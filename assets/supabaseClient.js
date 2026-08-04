import { createClient } from "./vendor/supabase-js-2.108.2.js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./shared.js?v=202608041708";

export {
  APP_VERSION,
  ARCHIVE_BUCKET,
  ATTENDANCE_DOCUMENT_BUCKET,
  SITE_MEDIA_BUCKET,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  URL_RULES,
  byId,
  escapeHtml,
  formatDate,
  formatDateTime,
  getCurrentUrlWithoutHash,
  getDisplayName,
  getMaskedEmailName,
  getReviewAuthorName,
  groupBy,
  normalizeSafeUrl,
  randomPick,
  requireSafeUrl,
  shortDate,
  statusLabels,
  verificationLabels,
} from "./shared.js?v=202608041708";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

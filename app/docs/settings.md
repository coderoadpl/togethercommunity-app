# Tenant settings

Video autoplay is controlled by the creator in **Studio → Settings → Company → Video playback**. The tenant default applies when member overrides are disabled or a member has not chosen a preference; when overrides are enabled, members can choose autoplay from their account page. The CLI exposes the same policy through `tenant settings` and `tenant settings-set --video-autoplay-default <true|false> --member-video-autoplay-override <true|false>`.

// config.js — single source of truth for the developer/social/contact info
// shown in Settings and the About page. Nothing here ever changes based on
// user data; it's static app metadata, kept in one place so it's never
// hardcoded into HTML strings in more than one spot.

export const APP_CONFIG = {
  developer: {
    name: 'Peter Elea',
    role: 'Full Stack Web Developer',
    links: {
      linkedin: 'https://www.linkedin.com/in/peter-elea-71689935a/',
      instagram: 'https://www.instagram.com/beter_elea/',
      github: '' // leave empty until a real profile URL exists — never invent one
    }
  },
  whatsapp: {
    // Stored once, in international format (no leading 00/+/spaces), exactly
    // as wa.me expects it. Everything else derives from this.
    phone: '201550870190'
  },
  push: {
    // Public VAPID key for Web Push (safe to expose — it's the public half
    // of the keypair). Generate with `npx web-push generate-vapid-keys` and
    // paste the "Public Key" value here; the private key goes ONLY in
    // Vercel's environment variables, never in this file.
    // Leave empty to keep the "reminders while closed" feature hidden/disabled.
    vapidPublicKey: 'BG5KD9ZrTvmvflBWgegFCvHffEUbW5ur55HNBIcGhqQzjWvvcFc1dSsSRUuxfMo1OESX-2Q5DOZNtVgQu3JKWG0'
  }
};

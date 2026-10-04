// Feedback is still sent to WhatsApp for convenience, and logged in Turso
// when the visitor is signed in so the admin panel can track reports.

import { APP_CONFIG } from '../config.js';
import { getCurrentUser } from './cloud.js';

const MESSAGES = {
  bug: 'مرحبًا، واجهت مشكلة في فكّرني وأريد الإبلاغ عنها.',
  feature: 'مرحبًا، عندي اقتراح لميزة جديدة في فكّرني.',
  review: 'مرحبًا، حابب أشارك رأيي في تجربة استخدام فكّرني.'
};

function buildWhatsAppUrl(message) {
  const phone = (APP_CONFIG.whatsapp && APP_CONFIG.whatsapp.phone) || '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export async function openFeedback(kind) {
  try {
    const message = MESSAGES[kind] || MESSAGES.review;
    const user = getCurrentUser();
    if (user) {
      fetch('/api/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, message })
      }).catch(() => {});
    }
    const url = buildWhatsAppUrl(message);
    window.open(url, '_blank', 'noopener');
    return true;
  } catch (e) {
    console.warn('feedback: could not open WhatsApp', e);
    return false;
  }
}

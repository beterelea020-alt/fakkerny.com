// features/feedback.js — everything about sending feedback to the developer
// goes through here, so the three feedback buttons (bug/feature/review) in
// Settings and About never build a wa.me URL themselves.

import { APP_CONFIG } from '../config.js';

const MESSAGES = {
  bug: 'مرحبًا، واجهت مشكلة في فكّرني وأريد الإبلاغ عنها.',
  feature: 'مرحبًا، عندي اقتراح لميزة جديدة في فكّرني.',
  review: 'مرحبًا، حابب أشارك رأيي في تجربة استخدام فكّرني.'
};

function buildWhatsAppUrl(message) {
  const phone = (APP_CONFIG.whatsapp && APP_CONFIG.whatsapp.phone) || '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

// kind: 'bug' | 'feature' | 'review'
export function openFeedback(kind) {
  try {
    const message = MESSAGES[kind] || MESSAGES.review;
    const url = buildWhatsAppUrl(message);
    window.open(url, '_blank', 'noopener');
    return true;
  } catch (e) {
    console.warn('feedback: could not open WhatsApp', e);
    return false;
  }
}

import type { Locale } from '@triphub/shared';

export interface Section { heading: string; body: string[] }
export interface ContentPage { title: string; lead: string; sections: Section[]; draftNote?: string }
export type PageKey = 'about' | 'help' | 'terms' | 'privacy';

/**
 * Editorial and policy copy. The legal pages are DRAFTS for review by a lawyer; they describe how the
 * product actually behaves today and must not be treated as final terms. Arabic is a first translation
 * awaiting a native-speaker review.
 */
export const PAGES: Record<Locale, Record<PageKey, ContentPage>> = {
  en: {
    about: {
      title: 'About TripHub and Lebanon',
      lead: 'TripHub brings Lebanon’s hikes, guided tours, food, culture and workshops together in one place, from businesses that have been reviewed by our team.',
      sections: [
        { heading: 'Why TripHub', body: ['Good local experiences are often hard to find and harder to book. TripHub lets verified Lebanese businesses publish what they really offer, with real dates, prices and cancellation terms, and lets you book in English or Arabic.', 'We never show invented prices, ratings or availability. If something is not known, we say so.'] },
        { heading: 'Lebanon in a few lines', body: ['Lebanon is a small Mediterranean country where mountains, valleys and coast are close together. You can walk among ancient cedars in the Chouf and in the north, explore the Qadisha Valley, wander through the old harbour town of Byblos, and see the Roman temples of Baalbek in the Bekaa.', 'Byblos, Baalbek, Tyre, Anjar and the Qadisha Valley with the Forest of the Cedars of God are all UNESCO World Heritage sites.'] },
        { heading: 'For businesses', body: ['Guides, restaurants, museums and workshop hosts can join, get verified, and manage listings, dates, bookings and teams from one workspace.'] },
      ],
    },
    help: {
      title: 'Help and frequently asked questions',
      lead: 'Straight answers about booking, payment and cancellation.',
      sections: [
        { heading: 'How does booking work?', body: ['Choose an experience, pick a date and the number of guests, and book. Free experiences are confirmed immediately. Some experiences are “request to book”: the business must approve first, and nothing is confirmed until it does.', 'A booking shown as “held” is not confirmed. A seat is only yours once the booking says Confirmed.'] },
        { heading: 'Can I pay on TripHub today?', body: ['Online payments are not switched on yet. Where payments are enabled, you will pay by Whish Money or OMT and send us the transfer reference; the booking is confirmed only after our team verifies that the money arrived. A screenshot or reference alone is never treated as proof of payment.'] },
        { heading: 'What if I need to cancel?', body: ['Each experience shows its cancellation policy before you book, and that policy is fixed for your booking. If the business cancels, you are refunded in full. Refunds are sent manually and are shown as “refunded” only after the transfer is made.'] },
        { heading: 'What is the waiting list?', body: ['If a date is full you can join its waiting list. Seats that free up are offered to the person at the front of the queue first, for a limited time. Nothing is booked or charged until you accept.'] },
        { heading: 'How do I contact support?', body: ['A support channel is not set up yet. This page will list it as soon as it exists.'] },
      ],
    },
    terms: {
      title: 'Terms of use (draft)',
      lead: 'How TripHub works and what you can expect from it.',
      draftNote: 'DRAFT for legal review. This text describes how the product behaves today. It is not final legal terms and is not legal advice.',
      sections: [
        { heading: 'The service', body: ['TripHub is a marketplace. Experiences are provided by independent businesses, not by TripHub. TripHub verifies businesses before they can publish, but each business is responsible for its own experience.'] },
        { heading: 'Bookings and payments', body: ['A booking is confirmed only when the booking page says Confirmed. Prices are calculated by TripHub from the business’s published rates. Payment features are limited while online payments are not enabled.'] },
        { heading: 'Cancellations and refunds', body: ['The cancellation policy shown when you book applies to that booking. If a business cancels, you receive a full refund. Refunds are processed manually by TripHub finance.'] },
        { heading: 'Accounts and conduct', body: ['Keep your sign-in details private. Reviews may only be written for experiences you completed, and TripHub may hide a review that breaks the rules, recording the reason.'] },
        { heading: 'Changes', body: ['We may update these terms; the version in force is the one published here.'] },
      ],
    },
    privacy: {
      title: 'Privacy notice (draft)',
      lead: 'What we collect, why, and the choices you have.',
      draftNote: 'DRAFT for legal review. It describes current behaviour and must be checked against Lebanese law and your data processors before launch.',
      sections: [
        { heading: 'What we collect', body: ['Account details (email, name, language), your bookings, payment references you submit, notifications, and business verification documents for business accounts.'] },
        { heading: 'How we use it', body: ['To run your account and bookings, to verify payments and businesses, to keep the service secure, and to show you information about your own bookings.'] },
        { heading: 'Security', body: ['Passwords are stored as one-way hashes, sessions can be revoked, sensitive staff actions need two-step verification, and uploaded documents are visible only to the business and TripHub reviewers.'] },
        { heading: 'Email and tracking', body: ['Email delivery and analytics trackers are not connected at the moment. We do not sell personal data.'] },
        { heading: 'Your choices', body: ['You can change your name and language in your profile. A tool to export or delete your data is not built yet; until then contact us once a support channel is published.'] },
      ],
    },
  },
  ar: {
    about: {
      title: 'عن TripHub ولبنان',
      lead: 'يجمع TripHub رحلات المشي والجولات المرشدة والطعام والثقافة والورش في لبنان في مكان واحد، من جهات راجعها فريقنا.',
      sections: [
        { heading: 'لماذا TripHub', body: ['من الصعب غالباً العثور على تجارب محلية جيدة وأصعب منه حجزها. يتيح TripHub للجهات اللبنانية الموثّقة نشر ما تقدّمه فعلاً بمواعيد وأسعار وشروط إلغاء حقيقية، ويتيح لك الحجز بالعربية أو الإنجليزية.', 'لا نعرض أبداً أسعاراً أو تقييمات أو توفراً مختلقاً. وإذا كان أمر غير معروف فنقول ذلك.'] },
        { heading: 'لبنان في أسطر', body: ['لبنان بلد متوسطي صغير تتقارب فيه الجبال والوديان والساحل. يمكنك المشي بين أشجار الأرز العتيقة في الشوف والشمال، واستكشاف وادي قاديشا، والتجول في مدينة جبيل الساحلية القديمة، ومشاهدة معابد بعلبك الرومانية في البقاع.', 'جبيل وبعلبك وصور وعنجر ووادي قاديشا مع غابة أرز الرب كلها مواقع على لائحة اليونسكو للتراث العالمي.'] },
        { heading: 'للجهات', body: ['يمكن للمرشدين والمطاعم والمتاحف ومضيفي الورش الانضمام والتوثيق وإدارة العروض والمواعيد والحجوزات والفريق من مساحة عمل واحدة.'] },
      ],
    },
    help: {
      title: 'المساعدة والأسئلة الشائعة',
      lead: 'إجابات مباشرة عن الحجز والدفع والإلغاء.',
      sections: [
        { heading: 'كيف يعمل الحجز؟', body: ['اختر تجربة وحدّد التاريخ وعدد الضيوف ثم احجز. تُؤكَّد التجارب المجانية فوراً. بعض التجارب «بطلب حجز»: يجب أن توافق الجهة أولاً ولا يتأكد شيء قبل ذلك.', 'الحجز الظاهر كـ«محجوز مؤقتاً» غير مؤكد. المقعد يصبح لك فقط عندما يظهر الحجز «مؤكد».'] },
        { heading: 'هل يمكنني الدفع عبر TripHub اليوم؟', body: ['الدفع عبر الإنترنت غير مفعّل بعد. عند تفعيله ستدفع عبر Whish Money أو OMT وترسل لنا مرجع التحويل، ولا يتأكد الحجز إلا بعد أن يتحقق فريقنا من وصول المبلغ. لا تُعتبر لقطة الشاشة أو المرجع وحدهما إثباتاً للدفع.'] },
        { heading: 'ماذا لو احتجت إلى الإلغاء؟', body: ['تعرض كل تجربة سياسة الإلغاء قبل الحجز وتبقى هذه السياسة ثابتة لحجزك. إذا ألغت الجهة الحجز يُسترد المبلغ كاملاً. تُرسل المبالغ المستردة يدوياً وتظهر «مستردة» فقط بعد إتمام التحويل.'] },
        { heading: 'ما هي قائمة الانتظار؟', body: ['إذا اكتمل تاريخ ما يمكنك الانضمام إلى قائمة انتظاره. تُعرض المقاعد التي تتحرر أولاً على صاحب الدور الأول لمدة محدودة. لا يُحجز ولا يُحصَّل شيء حتى توافق.'] },
        { heading: 'كيف أتواصل مع الدعم؟', body: ['قناة الدعم غير مُعدّة بعد. ستظهر هنا فور وجودها.'] },
      ],
    },
    terms: {
      title: 'شروط الاستخدام (مسودة)',
      lead: 'كيف يعمل TripHub وما الذي تتوقعه منه.',
      draftNote: 'مسودة للمراجعة القانونية. يصف هذا النص سلوك المنتج اليوم، وليس شروطاً قانونية نهائية ولا استشارة قانونية.',
      sections: [
        { heading: 'الخدمة', body: ['TripHub سوق إلكتروني. تقدّم التجارب جهات مستقلة وليس TripHub. يتحقق TripHub من الجهات قبل أن تنشر، لكن كل جهة مسؤولة عن تجربتها.'] },
        { heading: 'الحجوزات والدفع', body: ['لا يتأكد الحجز إلا عندما تعرض صفحته «مؤكد». يحسب TripHub الأسعار من أسعار الجهة المنشورة. ميزات الدفع محدودة طالما أن الدفع عبر الإنترنت غير مفعّل.'] },
        { heading: 'الإلغاء والاسترداد', body: ['تنطبق سياسة الإلغاء المعروضة عند الحجز على ذلك الحجز. إذا ألغت الجهة تحصل على استرداد كامل. تعالج مالية TripHub المبالغ المستردة يدوياً.'] },
        { heading: 'الحسابات والسلوك', body: ['حافظ على سرية بيانات دخولك. لا يمكن كتابة تقييم إلا لتجربة أتممتها، ويجوز لـTripHub إخفاء تقييم يخالف القواعد مع تسجيل السبب.'] },
        { heading: 'التعديلات', body: ['قد نحدّث هذه الشروط؛ والنسخة السارية هي المنشورة هنا.'] },
      ],
    },
    privacy: {
      title: 'إشعار الخصوصية (مسودة)',
      lead: 'ما نجمعه ولماذا والخيارات المتاحة لك.',
      draftNote: 'مسودة للمراجعة القانونية. تصف السلوك الحالي ويجب مطابقتها مع القانون اللبناني ومعالجي البيانات قبل الإطلاق.',
      sections: [
        { heading: 'ما نجمعه', body: ['بيانات الحساب (البريد والاسم واللغة) وحجوزاتك ومراجع الدفع التي ترسلها والإشعارات ومستندات توثيق الجهات لحسابات الجهات.'] },
        { heading: 'كيف نستخدمه', body: ['لتشغيل حسابك وحجوزاتك، وللتحقق من الدفعات والجهات، ولحماية الخدمة، ولعرض معلومات حجوزاتك.'] },
        { heading: 'الأمان', body: ['تُخزَّن كلمات المرور كبصمات أحادية الاتجاه، ويمكن إلغاء الجلسات، وتتطلب إجراءات الموظفين الحساسة تحققاً بخطوتين، ولا يرى المستندات المرفوعة إلا الجهة ومراجعو TripHub.'] },
        { heading: 'البريد والتتبع', body: ['خدمة البريد وأدوات التحليل غير موصولة حالياً. لا نبيع البيانات الشخصية.'] },
        { heading: 'خياراتك', body: ['يمكنك تغيير اسمك ولغتك من ملفك. أداة تصدير بياناتك أو حذفها غير مبنية بعد؛ وإلى ذلك الحين تواصل معنا عند نشر قناة الدعم.'] },
      ],
    },
  },
};

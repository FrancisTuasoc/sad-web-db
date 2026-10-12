const { z } = require('zod');

const checkoutSchema = z
  .object({
    cartItemIds: z
      .array(z.string())
      .min(1, 'Please select at least one item to checkout'),
    fulfillment: z.enum(['pickup', 'delivery']),
    paymentMethod: z.enum(['gcash', 'pay_at_shop', 'cod']),
    gcashReference: z.string().trim().max(13).optional().default(''),
    gcashProofData: z.string().max(4_194_304).optional().default(''),
    gcashProofMimeType: z
      .enum(['image/jpeg', 'image/png', 'image/webp', ''])
      .optional()
      .default(''),
    contact: z.object({
      firstName: z
        .string()
        .trim()
        .min(1, 'Please provide your first name')
        .max(60),
      lastName: z
        .string()
        .trim()
        .min(1, 'Please provide your last name')
        .max(60),
      fullName: z.string().trim().max(121).optional().default(''),
      email: z
        .string()
        .trim()
        .email('Please provide a valid email address')
        .max(254),
      phone: z
        .string()
        .trim()
        .refine(
          (phone) => /^(09\d{9}|\+639\d{9})$/.test(phone.replace(/[\s-]/g, '')),
          'Please provide a valid Philippine mobile number'
        ),
      street: z.string().trim().max(120).optional().default(''),
      barangay: z.string().trim().max(100).optional().default(''),
      city: z.string().trim().max(100).optional().default(''),
      province: z.string().trim().max(100).optional().default(''),
      postalCode: z.string().trim().max(4).optional().default(''),
      address: z.string().trim().optional().default(''),
    }),
  })
  .superRefine((data, context) => {
    const hasProof = Boolean(data.gcashProofData && data.gcashProofMimeType);
    const hasAnyProof = Boolean(data.gcashProofData || data.gcashProofMimeType);
    const hasReference = Boolean(data.gcashReference);
    if (hasAnyProof && !hasProof) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Payment screenshot data is incomplete.',
        path: ['gcashProofData'],
      });
    }
    if (data.paymentMethod === 'gcash' && !hasProof && !hasReference) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter the 13-digit demo reference or attach an image for admin review.',
        path: ['gcashReference'],
      });
    }
    if (
      hasReference &&
      !hasProof &&
      !/^\d{13}$/.test(data.gcashReference)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'GCash reference numbers must contain exactly 13 digits.',
        path: ['gcashReference'],
      });
    }
    if (data.paymentMethod !== 'gcash' && (hasAnyProof || hasReference)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'GCash proof is only accepted for GCash orders.',
        path: ['gcashProofData'],
      });
    }

    if (data.contact.postalCode && !/^\d{4}$/.test(data.contact.postalCode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a 4-digit postal code.',
        path: ['contact', 'postalCode'],
      });
    }
    if (data.fulfillment === 'delivery') {
      const parts = ['street', 'barangay', 'city', 'province', 'postalCode'];
      if (!parts.every((part) => data.contact[part])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Complete every delivery address field.',
          path: ['contact', 'address'],
        });
      }
      if (!data.contact.postalCode) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter a 4-digit postal code.',
          path: ['contact', 'postalCode'],
        });
      }
    }
  });

module.exports = checkoutSchema;

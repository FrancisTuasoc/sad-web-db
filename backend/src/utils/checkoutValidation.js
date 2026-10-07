const { z } = require('zod');

const checkoutSchema = z.object({
  cartItemIds: z.array(z.string()).min(1, 'Please select at least one item to checkout'),
  fulfillment: z.enum(['pickup', 'delivery']),
  paymentMethod: z.enum(['gcash', 'pay_at_shop', 'cod']),
  gcashReference: z.string().optional().default(''),
  contact: z.object({
    firstName: z.string().trim().min(1, 'Please provide your first name').max(60),
    lastName: z.string().trim().min(1, 'Please provide your last name').max(60),
    fullName: z.string().trim().max(121).optional().default(''),
    email: z.string().trim().email('Please provide a valid email address').max(254),
    phone: z.string().trim().refine(
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
}).refine((data) => {
  if (data.contact.postalCode && !/^\d{4}$/.test(data.contact.postalCode)) return false;
  if (data.fulfillment === 'delivery') {
    const parts = ['street', 'barangay', 'city', 'province', 'postalCode'];
    return parts.every((part) => data.contact[part])
      && /^\d{4}$/.test(data.contact.postalCode);
  }
  return true;
}, {
  message: 'Complete every delivery address field and enter a 4-digit postal code.',
  path: ['contact', 'postalCode'],
});

module.exports = checkoutSchema;

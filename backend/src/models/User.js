const mongoose = require('mongoose');
const { isValidGmailAddress } = require('../utils/accountValidation');
const { deleteAvatarForUser } = require('../services/avatarStorage');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
      match: [/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Username must start with a letter and can only contain letters, numbers, and underscores'],
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: function (email) {
          return this.role !== 'customer' || isValidGmailAddress(email);
        },
        message: 'Customer email must be a Gmail address with a 6-30 character local part containing at least 2 letters and more letters than numbers',
      },
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['customer', 'admin'],
      default: 'customer',
    },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
    },
    avatarUrl: {
      type: String,
      default: '',
    },
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    contactEmail: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
    },
    firstName: {
      type: String,
      default: '',
      trim: true,
    },
    lastName: {
      type: String,
      default: '',
      trim: true,
    },
    fullName: {
      type: String,
      default: '',
      trim: true,
    },
    street: {
      type: String,
      default: '',
      trim: true,
    },
    barangay: {
      type: String,
      default: '',
      trim: true,
    },
    city: {
      type: String,
      default: '',
      trim: true,
    },
    province: {
      type: String,
      default: '',
      trim: true,
    },
    postalCode: {
      type: String,
      default: '',
      trim: true,
      validate: {
        validator: (postalCode) => !postalCode || /^\d{4}$/.test(postalCode),
        message: 'Postal code must contain exactly 4 digits',
      },
    },
    address: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.post('findOneAndDelete', async function (user) {
  if (user) await deleteAvatarForUser(user);
});

userSchema.post('deleteOne', { document: true, query: false }, async function () {
  await deleteAvatarForUser(this);
});

userSchema.pre('deleteOne', { document: false, query: true }, async function () {
  this._avatarUserForCleanup = await this.model.findOne(this.getFilter()).select('avatarUrl').lean();
});

userSchema.post('deleteOne', { document: false, query: true }, async function (result) {
  if (result.deletedCount && this._avatarUserForCleanup) {
    await deleteAvatarForUser(this._avatarUserForCleanup);
  }
});

userSchema.pre('deleteMany', async function () {
  this._avatarsForCleanup = await this.model.find(this.getFilter()).select('avatarUrl').lean();
});

userSchema.post('deleteMany', async function (result) {
  if (!result.deletedCount || !this._avatarsForCleanup) return;
  for (const user of this._avatarsForCleanup) {
    await deleteAvatarForUser(user);
  }
});

module.exports = mongoose.model('User', userSchema);

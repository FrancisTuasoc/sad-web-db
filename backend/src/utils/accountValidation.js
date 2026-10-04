function isValidUsername(username) {
  return typeof username === 'string'
    && username.length >= 3
    && username.length <= 20
    && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(username);
}

function isValidGmailAddress(email) {
  const match = /^([a-z0-9]+(?:\.[a-z0-9]+)*)@gmail\.com$/i.exec(email);
  if (!match) return false;

  const localPart = match[1];
  const letters = (localPart.match(/[a-z]/gi) || []).length;
  const numbers = (localPart.match(/[0-9]/g) || []).length;
  return localPart.length >= 6 && localPart.length <= 30 && letters >= 2 && letters > numbers;
}

function isValidCustomerAccount(user) {
  if (user.role === 'admin') return true;
  return user.role === 'customer'
    && isValidUsername(user.username)
    && isValidGmailAddress(user.email);
}

module.exports = { isValidGmailAddress, isValidUsername, isValidCustomerAccount };

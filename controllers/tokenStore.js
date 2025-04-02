// tokenStore.js
let userAccessToken = null;

module.exports = {
  getUserAccessToken: () => userAccessToken,
  setUserAccessToken: (token) => {
    userAccessToken = token;
  },
};

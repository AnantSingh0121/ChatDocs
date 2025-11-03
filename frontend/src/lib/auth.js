export function isTokenExpired(token) {
  if (!token) return true;

  try {
    const [, payloadBase64] = token.split(".");
    const payload = JSON.parse(atob(payloadBase64));
    const exp = payload.exp * 1000; 
    return Date.now() > exp;
  } catch (err) {
    console.error("Token decode failed:", err);
    return true;
  }
}

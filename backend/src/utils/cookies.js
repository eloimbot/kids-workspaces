export function parseCookies(headerValue) {
  if (!headerValue) {
    return {};
  }

  return headerValue
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, item) => {
      const separatorIndex = item.indexOf("=");

      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = item.slice(0, separatorIndex);
      const value = item.slice(separatorIndex + 1);
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

export function buildCookie(name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (maxAgeSeconds === 0) {
    parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  } else if (typeof maxAgeSeconds === "number") {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

import Forbidden from "../forbidden";

// Target of the middleware rewrite for role-denied paths (served with HTTP 403).
export default function ForbiddenPage() {
  return <Forbidden />;
}

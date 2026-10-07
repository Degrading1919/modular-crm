import PublicSignup from "../../../../components/PublicSignup";
import { mocksAllowed } from "../../../../lib/mock-policy";

export default async function SignupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicSignup slug={slug} allowDemoPayments={mocksAllowed()} loginUrl={new URL("/login", process.env.APP_BASE_URL ?? "http://localhost:3000").toString()} />;
}

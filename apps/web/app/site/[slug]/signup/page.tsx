import PublicSignup from "../../../../components/PublicSignup";

export default async function SignupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicSignup slug={slug} />;
}

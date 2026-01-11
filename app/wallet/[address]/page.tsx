import WalletProfileClient from "./WalletProfileClient";

export default async function WalletProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return <WalletProfileClient address={address} />;
}

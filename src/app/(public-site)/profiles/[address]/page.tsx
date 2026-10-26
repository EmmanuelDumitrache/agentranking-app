import { ProfileClient } from "./profile-client";
import { fetchProfilePageSnapshot, normalizePublicProfileAddress } from "@/lib/profile-detail";
type Props = { params: Promise<{ address: string }> };
export const dynamic = "force-dynamic";
export default async function ProfilePage({ params }: Props) {
  const { address: rawAddress } = await params;
  const address = normalizePublicProfileAddress(rawAddress);
  const snapshot = await fetchProfilePageSnapshot(address);
  return (
    <ProfileClient
      address={address}
      initialData={snapshot.data}
      initialFollowerAddress={snapshot.viewer.followerAddress}
      initialFollowing={snapshot.viewer.isFollowing}
    />
  );
}

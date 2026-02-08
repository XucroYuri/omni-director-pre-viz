import EpisodeDetailClient from './EpisodeDetailClient';

export default async function EpisodeDetailPage({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  return <EpisodeDetailClient episodeId={episodeId} />;
}

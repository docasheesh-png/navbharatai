import { useMemo, useRef, useState } from 'react';
import { Shell, Card, Badge, Button, Field, Modal, Empty } from './lib/ui';
import { useCollection, shortDate, newId, type Entity } from './lib/store';
import ThemeToggle from './theme';

interface Comment { id: string; author: string; text: string; at: string }
interface Post extends Entity {
  author: string; text: string; image: string; at: string;
  likedBy: string[]; comments: Comment[]; reported: boolean;
}
interface Person extends Entity { name: string; bio: string }

const ME = 'You';

const SEED_PEOPLE: Person[] = [
  { id: 'u1', name: 'Asha', bio: 'Photographer in Jaipur' },
  { id: 'u2', name: 'Rohit', bio: 'Runs a chai stall, loves cricket' },
  { id: 'u3', name: 'Meera', bio: 'Teacher · gardening on weekends' },
];

const SEED_POSTS: Post[] = [
  { id: 'p1', author: 'Asha', text: 'Sunrise over Amber Fort this morning.', image: '', at: '2026-08-03', likedBy: ['Rohit'], comments: [{ id: 'c1', author: 'Meera', text: 'Beautiful!', at: '2026-08-03' }], reported: false },
  { id: 'p2', author: 'Rohit', text: 'New masala chai recipe at the stall — come try it.', image: '', at: '2026-08-02', likedBy: [], comments: [], reported: false },
];

export default function App() {
  const [screen, setScreen] = useState('feed');
  const posts = useCollection<Post>('social.posts', SEED_POSTS);
  const people = useCollection<Person>('social.people', SEED_PEOPLE);
  const [following, setFollowing] = useState<string[]>(() => {
    try { const raw = localStorage.getItem('social.following'); return raw ? JSON.parse(raw) : ['Asha']; } catch { return ['Asha']; }
  });
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [image, setImage] = useState('');
  const [commentOn, setCommentOn] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const visible = useMemo(() => {
    // Reported posts are hidden from the feed but never deleted — moderation is a review queue, not a
    // shredder, so an admin can still look at what was flagged.
    const base = posts.items.filter((p) => !p.reported);
    return screen === 'following' ? base.filter((p) => following.includes(p.author) || p.author === ME) : base;
  }, [posts.items, screen, following]);

  const notifications = useMemo(() => {
    const out: Array<{ id: string; text: string; at: string }> = [];
    for (const p of posts.items) {
      if (p.author !== ME) continue;
      for (const who of p.likedBy) out.push({ id: p.id + who, text: who + ' liked your post', at: p.at });
      for (const c of p.comments) out.push({ id: c.id, text: c.author + ' commented: ' + c.text, at: c.at });
    }
    return out;
  }, [posts.items]);

  function saveFollowing(next: string[]) {
    setFollowing(next);
    try { localStorage.setItem('social.following', JSON.stringify(next)); } catch { /* private mode */ }
  }

  function toggleFollow(name: string) {
    saveFollowing(following.includes(name) ? following.filter((n) => n !== name) : [...following, name]);
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  }

  function publish() {
    if (!text.trim() && !image) return;
    posts.add({
      author: ME, text: text.trim(), image, at: new Date().toISOString().slice(0, 10),
      likedBy: [], comments: [], reported: false,
    });
    setText(''); setImage(''); setComposing(false); setScreen('feed');
  }

  function toggleLike(p: Post) {
    posts.update(p.id, { likedBy: p.likedBy.includes(ME) ? p.likedBy.filter((n) => n !== ME) : [...p.likedBy, ME] });
  }

  function addComment() {
    const p = posts.items.find((x) => x.id === commentOn);
    if (!p || !commentText.trim()) return;
    const c: Comment = { id: newId(), author: ME, text: commentText.trim(), at: new Date().toISOString().slice(0, 10) };
    posts.update(p.id, { comments: [...p.comments, c] });
    setCommentText('');
  }

  const openPost = commentOn ? posts.items.find((p) => p.id === commentOn) || null : null;

  return (
    <Shell
      brand="Chaupal"
      nav={[
        { id: 'feed', label: 'Feed' },
        { id: 'following', label: 'Following' },
        { id: 'people', label: 'People' },
        { id: 'alerts', label: 'Notifications (' + notifications.length + ')' },
      ]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      {(screen === 'feed' || screen === 'following') && (
        <>
          <Card>
            <Button onClick={() => setComposing(true)}>Write a post</Button>
          </Card>
          {visible.length === 0 ? (
            <Empty>{screen === 'following' ? 'Follow someone to see their posts here.' : 'Nothing here yet — write the first post.'}</Empty>
          ) : visible.map((p) => (
            <Card key={p.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 34, height: 34, borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
                  {p.author.slice(0, 1)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{p.author}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{shortDate(p.at)}</div>
                </div>
                {p.author !== ME && (
                  <Button variant="ghost" onClick={() => toggleFollow(p.author)}>
                    {following.includes(p.author) ? 'Following' : 'Follow'}
                  </Button>
                )}
              </div>
              {p.text && <p style={{ fontSize: 15, margin: '0 0 10px', lineHeight: 1.5 }}>{p.text}</p>}
              {p.image && <img src={p.image} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 10, display: 'block' }} />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button variant="ghost" onClick={() => toggleLike(p)}>
                  {p.likedBy.includes(ME) ? 'Liked' : 'Like'} ({p.likedBy.length})
                </Button>
                <Button variant="ghost" onClick={() => setCommentOn(p.id)}>Comments ({p.comments.length})</Button>
                <span style={{ flex: 1 }} />
                <Button variant="ghost" onClick={() => posts.update(p.id, { reported: true })}>Report</Button>
              </div>
            </Card>
          ))}
        </>
      )}

      {screen === 'people' && (
        <Card title={'People (' + people.items.length + ')'}>
          {people.items.map((u) => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 34, height: 34, borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
                {u.name.slice(0, 1)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.bio}</div>
              </div>
              <Button variant="ghost" onClick={() => toggleFollow(u.name)}>
                {following.includes(u.name) ? 'Following' : 'Follow'}
              </Button>
            </div>
          ))}
        </Card>
      )}

      {screen === 'alerts' && (
        <Card title="Notifications">
          {notifications.length === 0 ? (
            <Empty>Nothing new. Likes and comments on your posts show up here.</Empty>
          ) : notifications.map((n) => (
            <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14 }}>{n.text}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{shortDate(n.at)}</div>
            </div>
          ))}
          {posts.items.some((p) => p.reported) && (
            <div style={{ marginTop: 14 }}>
              <Badge tone="warn">{posts.items.filter((p) => p.reported).length} reported post(s) hidden from the feed</Badge>
            </div>
          )}
        </Card>
      )}

      {composing && (
        <Modal title="New post" onClose={() => setComposing(false)}>
          <Field label="What's happening?" value={text} onChange={setText} placeholder="Say something…" />
          <input
            ref={fileRef}
            aria-label="Choose an image"
            type="file"
            accept="image/*"
            onChange={(e) => pickImage(e.target.files ? e.target.files[0] : undefined)}
            style={{ display: 'none' }}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <Button variant="ghost" onClick={() => fileRef.current && fileRef.current.click()}>
              {image ? 'Change photo' : 'Add photo'}
            </Button>
            {image && <Button variant="ghost" onClick={() => setImage('')}>Remove</Button>}
          </div>
          {image && <img src={image} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 10, display: 'block' }} />}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={publish}>Post</Button>
            <Button variant="ghost" onClick={() => setComposing(false)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {openPost && (
        <Modal title={'Comments on ' + openPost.author + "'s post"} onClose={() => setCommentOn(null)}>
          {openPost.comments.length === 0 ? (
            <Empty>No comments yet.</Empty>
          ) : openPost.comments.map((c) => (
            <div key={c.id} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
              <div style={{ fontSize: 13 }}><strong>{c.author}</strong> {c.text}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{shortDate(c.at)}</div>
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            <Field label="Add a comment" value={commentText} onChange={setCommentText} placeholder="Write something kind" />
            <Button onClick={addComment}>Comment</Button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}

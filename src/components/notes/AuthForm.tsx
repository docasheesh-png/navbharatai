import { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../lib/firebase';

export const AuthForm = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) { alert(err.message); }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 max-w-sm mx-auto space-y-4">
      <h2 className="text-2xl">{isLogin ? 'Login' : 'Signup'}</h2>
      <input type="email" placeholder="Email" className="w-full p-2 bg-gray-800 text-white rounded" onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="Password" className="w-full p-2 bg-gray-800 text-white rounded" onChange={(e) => setPassword(e.target.value)} />
      <button type="submit" className="w-full bg-blue-600 p-2 rounded text-white">{isLogin ? 'Login' : 'Signup'}</button>
      <button type="button" onClick={() => setIsLogin(!isLogin)} className="text-blue-400">Switch to {isLogin ? 'Signup' : 'Login'}</button>
    </form>
  );
};

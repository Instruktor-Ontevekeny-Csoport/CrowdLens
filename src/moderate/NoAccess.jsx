import { supabase } from '../lib/supabase.js'
import OpenAppLink from './OpenAppLink.jsx'

export default function NoAccess({ email }) {
  return (
    <div className="login">
      <h1>No access yet</h1>
      <p>
        You are signed in as <strong>{email}</strong>, but this address is not on the staff list.
        Ask an admin to add you, then reload this page.
      </p>
      <button type="button" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
      <OpenAppLink small />
    </div>
  )
}

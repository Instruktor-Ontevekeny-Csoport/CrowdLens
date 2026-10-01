export default function OpenAppLink({ small = false }) {
  return (
    <a
      className={`open-app ${small ? 'small' : ''}`}
      href="/"
      target="_blank"
      rel="noopener"
      data-testid="open-app"
    >
      📸 Open CrowdLens app
    </a>
  )
}

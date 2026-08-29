import { render, screen } from '@testing-library/react'
import UploadApp from '../upload/App.jsx'

test('upload app renders', () => {
  render(<UploadApp />)
  expect(screen.getByText(/CrowdLens/i)).toBeInTheDocument()
})

import { useRoute } from './router';
import { Timeline } from './screens/Timeline';
import { Editor } from './screens/Editor';
import { Player } from './screens/Player';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'new':
      return <Editor key="new" />;
    case 'edit':
      return <Editor key={route.id} id={route.id} />;
    case 'play':
      return <Player query={route.query} />;
    default:
      return <Timeline query={route.query} />;
  }
}

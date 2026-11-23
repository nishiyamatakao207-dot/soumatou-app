import { useRoute } from './router';
import { Timeline } from './screens/Timeline';
import { Editor } from './screens/Editor';
import { Player } from './screens/Player';
import { Export } from './screens/Export';
import { AddFeeling } from './screens/AddFeeling';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'new':
      return <Editor key={route.voice ? 'voice' : 'new'} voice={route.voice} />;
    case 'feel':
      return <AddFeeling id={route.id} />;
    case 'edit':
      return <Editor key={route.id} id={route.id} />;
    case 'play':
      return <Player query={route.query} />;
    case 'export':
      return <Export query={route.query} />;
    default:
      return <Timeline query={route.query} />;
  }
}

import { createMap } from './map';
import { showDrawer } from './messages';

async function main() {
    // Create the map
    try {
        await createMap();
    } catch (err) {
        console.error(err);
    }

    // Only show message if user has not seen the welcome message yet
    if (!localStorage.getItem('hasSeenPlacementWelcome')) {
        showDrawer({
            file: 'welcome',
            position: 'bottom',
            onClose: () => {
                localStorage.setItem('hasSeenPlacementWelcome', 'true');
            },
        });
    }
}
main();

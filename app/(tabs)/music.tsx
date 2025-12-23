import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  Platform,
} from 'react-native';
import { Audio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';

interface Song {
  id: number;
  name: string;
  uri: string;
}

export default function MusicPlayerScreen() {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadPlaylist();
    setupAudio();
    
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, []);

  const setupAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
      });
    } catch (error) {
      console.error('Audio setup error:', error);
    }
  };

  const loadPlaylist = async () => {
    try {
      const saved = await AsyncStorage.getItem('musicPlaylist');
      if (saved) {
        setPlaylist(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Load playlist error:', error);
    }
  };

  const savePlaylist = async (newPlaylist: Song[]) => {
    try {
      await AsyncStorage.setItem('musicPlaylist', JSON.stringify(newPlaylist));
    } catch (error) {
      console.error('Save playlist error:', error);
    }
  };

  const pickMusicFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets) {
        const newSongs: Song[] = result.assets.map((file, index) => ({
          id: Date.now() + index,
          name: file.name.replace(/\.[^/.]+$/, ''),
          uri: file.uri,
        }));

        const updatedPlaylist = [...playlist, ...newSongs];
        setPlaylist(updatedPlaylist);
        savePlaylist(updatedPlaylist);
        Alert.alert('Success', `Added ${newSongs.length} song(s)`);
      }
    } catch (error) {
      console.error('Pick files error:', error);
      Alert.alert('Error', 'Failed to load music files');
    }
  };

  const loadAndPlaySong = async (index: number) => {
    if (playlist.length === 0) return;

    try {
      setIsLoading(true);
      
      if (sound) {
        await sound.unloadAsync();
      }

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: playlist[index].uri },
        { shouldPlay: true },
        onPlaybackStatusUpdate
      );

      setSound(newSound);
      setCurrentSongIndex(index);
      setIsPlaying(true);
    } catch (error) {
      console.error('Load song error:', error);
      Alert.alert('Error', 'Failed to play this song');
    } finally {
      setIsLoading(false);
    }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setDuration(status.durationMillis || 0);
      setPosition(status.positionMillis || 0);
      setIsPlaying(status.isPlaying);

      if (status.didJustFinish) {
        playNext();
      }
    }
  };

  const togglePlayPause = async () => {
    if (!sound) {
      if (playlist.length > 0) {
        loadAndPlaySong(currentSongIndex);
      }
      return;
    }

    try {
      if (isPlaying) {
        await sound.pauseAsync();
      } else {
        await sound.playAsync();
      }
    } catch (error) {
      console.error('Toggle error:', error);
    }
  };

  const playNext = () => {
    if (playlist.length === 0) return;
    const nextIndex = (currentSongIndex + 1) % playlist.length;
    loadAndPlaySong(nextIndex);
  };

  const playPrevious = () => {
    if (playlist.length === 0) return;
    const prevIndex = currentSongIndex === 0 ? playlist.length - 1 : currentSongIndex - 1;
    loadAndPlaySong(prevIndex);
  };

  const seekToPosition = async (value: number) => {
    if (sound) {
      try {
        await sound.setPositionAsync(value);
      } catch (error) {
        console.error('Seek error:', error);
      }
    }
  };

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const removeSong = (id: number) => {
    const updatedPlaylist = playlist.filter((song) => song.id !== id);
    setPlaylist(updatedPlaylist);
    savePlaylist(updatedPlaylist);
    
    if (playlist[currentSongIndex]?.id === id && sound) {
      sound.unloadAsync();
      setSound(null);
      setIsPlaying(false);
    }
  };

  const renderSongItem = ({ item, index }: { item: Song; index: number }) => (
    <TouchableOpacity
      style={[
        styles.songItem,
        currentSongIndex === index && styles.activeSongItem,
      ]}
      onPress={() => loadAndPlaySong(index)}>
      <View style={styles.songInfo}>
        <Ionicons
          name={currentSongIndex === index && isPlaying ? 'volume-medium' : 'musical-note'}
          size={24}
          color={currentSongIndex === index ? '#1DB954' : '#666'}
        />
        <Text
          style={[
            styles.songName,
            currentSongIndex === index && styles.activeSongName,
          ]}
          numberOfLines={1}>
          {item.name}
        </Text>
      </View>
      <TouchableOpacity onPress={() => removeSong(item.id)} style={styles.deleteButton}>
        <Ionicons name="trash-outline" size={20} color="#ff4444" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Music</Text>
        <TouchableOpacity onPress={pickMusicFiles} style={styles.addButton}>
          <Ionicons name="add-circle" size={32} color="#1DB954" />
        </TouchableOpacity>
      </View>

      {playlist.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="musical-notes-outline" size={80} color="#666" />
          <Text style={styles.emptyText}>No music yet</Text>
          <Text style={styles.emptySubtext}>Tap the + button to add songs</Text>
        </View>
      ) : (
        <>
          <FlatList
            data={playlist}
            renderItem={renderSongItem}
            keyExtractor={(item) => item.id.toString()}
            style={styles.playlist}
            contentContainerStyle={styles.playlistContent}
          />

          <View style={styles.playerContainer}>
            <View style={styles.nowPlaying}>
              <Text style={styles.nowPlayingLabel}>NOW PLAYING</Text>
              <Text style={styles.currentSongName} numberOfLines={1}>
                {playlist[currentSongIndex]?.name || 'No song selected'}
              </Text>
            </View>

            <View style={styles.progressContainer}>
              <Text style={styles.timeText}>{formatTime(position)}</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={duration}
                value={position}
                onSlidingComplete={seekToPosition}
                minimumTrackTintColor="#1DB954"
                maximumTrackTintColor="#333"
                thumbTintColor="#1DB954"
              />
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>

            <View style={styles.controls}>
              <TouchableOpacity onPress={playPrevious} style={styles.controlButton}>
                <Ionicons name="play-skip-back" size={36} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={togglePlayPause}
                style={styles.playButton}
                disabled={isLoading}>
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={40}
                  color="#000"
                />
              </TouchableOpacity>

              <TouchableOpacity onPress={playNext} style={styles.controlButton}>
                <Ionicons name="play-skip-forward" size={36} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: '#1e1e1e',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  addButton: {
    padding: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 24,
    color: '#fff',
    marginTop: 20,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  playlist: {
    flex: 1,
  },
  playlistContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 200,
  },
  songItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  activeSongItem: {
    backgroundColor: '#282828',
    borderWidth: 1,
    borderColor: '#1DB954',
  },
  songInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  songName: {
    fontSize: 16,
    color: '#fff',
    marginLeft: 12,
    flex: 1,
  },
  activeSongName: {
    color: '#1DB954',
    fontWeight: '600',
  },
  deleteButton: {
    padding: 8,
  },
  playerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1e1e1e',
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  nowPlaying: {
    alignItems: 'center',
    marginBottom: 20,
  },
  nowPlayingLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
    letterSpacing: 1,
  },
  currentSongName: {
    fontSize: 20,
    color: '#fff',
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  slider: {
    flex: 1,
    marginHorizontal: 12,
    height: 40,
  },
  timeText: {
    fontSize: 12,
    color: '#666',
    width: 40,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 40,
  },
  controlButton: {
    padding: 12,
  },
  playButton: {
    backgroundColor: '#1DB954',
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { Audio, AVPlaybackStatus } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Modal,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

interface Song {
  id: number;
  name: string;
  uri: string;
  lyrics?: string;
}

const STORAGE_KEY = '@musicPlaylist_v1';
const PLAYBACK_UPDATE_INTERVAL = 100;

export default function MusicPlayerScreen() {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const [bass, setBass] = useState(0.5);
  const [treble, setTreble] = useState(0.5);

  const scrollY = useRef(new Animated.Value(0)).current;
  const isMounted = useRef(true);
  const playbackUpdateTimer = useRef<NodeJS.Timeout | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    isMounted.current = true;
    initializeApp();
    
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      isMounted.current = false;
      cleanup();
    };
  }, []);

  const initializeApp = async () => {
    try {
      await setupAudio();
      await loadPlaylist();
    } catch (error) {
      console.error('Initialization error:', error);
      Alert.alert('Initialization Error', 'Failed to initialize the music player.');
    }
  };

  const cleanup = async () => {
    if (playbackUpdateTimer.current) {
      clearInterval(playbackUpdateTimer.current);
    }
    if (sound) {
      try {
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  };

  const setupAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('Audio setup error:', error);
      throw error;
    }
  };

  const loadPlaylist = async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved && isMounted.current) {
        const parsedPlaylist = JSON.parse(saved);
        setPlaylist(parsedPlaylist);
      }
    } catch (error) {
      console.error('Load playlist error:', error);
      Alert.alert('Error', 'Failed to load your playlist.');
    }
  };

  const savePlaylist = async (newPlaylist: Song[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newPlaylist));
    } catch (error) {
      console.error('Save playlist error:', error);
      Alert.alert('Error', 'Failed to save playlist. Please try again.');
    }
  };

  const pickMusicFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ 
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: true, // Enable multiple file selection
      });
      
      if (result.canceled) {
        return;
      }

      if (result.assets && result.assets.length > 0) {
        // Process all selected files
        const newSongs: Song[] = result.assets.map((asset, index) => ({
          id: Date.now() + index, // Ensure unique IDs
          name: asset.name.replace(/\.[^/.]+$/, '') || 'Unknown Song',
          uri: asset.uri,
        }));
        
        const updatedPlaylist = [...playlist, ...newSongs];
        setPlaylist(updatedPlaylist);
        await savePlaylist(updatedPlaylist);
        
        const songCount = newSongs.length;
        Alert.alert(
          'Success', 
          `Added ${songCount} song${songCount > 1 ? 's' : ''} to your playlist`
        );
      }
    } catch (error) {
      console.error('Pick files error:', error);
      Alert.alert('Error', 'Failed to load music files. Please try again.');
    }
  };

  const loadAndPlaySong = async (index: number) => {
    if (playlist.length === 0 || index < 0 || index >= playlist.length) {
      return;
    }

    try {
      setIsLoading(true);
      animateSongChange(); // Trigger animation on song change

      // Unload previous sound
      if (sound) {
        try {
          await sound.stopAsync();
          await sound.unloadAsync();
        } catch (e) {
          console.error('Error unloading previous sound:', e);
        }
        setSound(null);
      }

      // Load new sound
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: playlist[index].uri },
        { 
          shouldPlay: true,
          progressUpdateIntervalMillis: PLAYBACK_UPDATE_INTERVAL,
        },
        onPlaybackStatusUpdate
      );

      if (isMounted.current) {
        setSound(newSound);
        setCurrentSongIndex(index);
        setIsPlaying(true);
      } else {
        await newSound.unloadAsync();
      }
    } catch (error) {
      console.error('Load song error:', error);
      Alert.alert(
        'Playback Error', 
        `Failed to play "${playlist[index].name}". The file may be corrupted or in an unsupported format.`
      );
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  };

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!isMounted.current) return;
    
    if (status.isLoaded) {
      setDuration(status.durationMillis || 0);
      setPosition(status.positionMillis || 0);
      setIsPlaying(status.isPlaying);

      if (status.didJustFinish && !status.isLooping) {
        playNext();
      }
    } else if (status.error) {
      console.error('Playback error:', status.error);
      setIsPlaying(false);
      Alert.alert('Playback Error', 'An error occurred during playback.');
    }
  }, []);

  const togglePlayPause = async () => {
    if (!sound) {
      if (playlist.length > 0) {
        await loadAndPlaySong(currentSongIndex);
      } else {
        Alert.alert('No Music', 'Please add songs to your playlist first.');
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
      console.error('Toggle play/pause error:', error);
      Alert.alert('Error', 'Failed to toggle playback.');
    }
  };

  const playNext = useCallback(() => {
    if (playlist.length === 0) return;
    const nextIndex = (currentSongIndex + 1) % playlist.length;
    loadAndPlaySong(nextIndex);
  }, [playlist.length, currentSongIndex]);

  const playPrevious = async () => {
    if (playlist.length === 0) return;
    
    if (position > 3000) {
      await seekToPosition(0);
    } else {
      const prevIndex = currentSongIndex === 0 ? playlist.length - 1 : currentSongIndex - 1;
      await loadAndPlaySong(prevIndex);
    }
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

  const removeSong = async (id: number) => {
    Alert.alert(
      'Remove Song',
      'Are you sure you want to remove this song from your playlist?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const updatedPlaylist = playlist.filter(song => song.id !== id);
            setPlaylist(updatedPlaylist);
            await savePlaylist(updatedPlaylist);
            
            // If currently playing song is removed
            const removedIndex = playlist.findIndex(song => song.id === id);
            if (removedIndex === currentSongIndex && sound) {
              await sound.stopAsync();
              await sound.unloadAsync();
              setSound(null);
              setIsPlaying(false);
              
              if (updatedPlaylist.length > 0) {
                const newIndex = Math.min(currentSongIndex, updatedPlaylist.length - 1);
                setCurrentSongIndex(newIndex);
              }
            }
          },
        },
      ]
    );
  };

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const miniPlayerHeight = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [80, 50],
    extrapolate: 'clamp',
  });

  const miniPlayerOpacity = scrollY.interpolate({
    inputRange: [0, 50],
    outputRange: [1, 0.95],
    extrapolate: 'clamp',
  });

  const animateSongChange = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const renderSongItem = ({ item, index }: { item: Song; index: number }) => {
    const inputRange = [
      (index - 1) * 72,
      index * 72,
      (index + 1) * 72,
    ];
    
    const scale = scrollY.interpolate({
      inputRange,
      outputRange: [1, 1, 0.95],
      extrapolate: 'clamp',
    });
    
    const opacity = scrollY.interpolate({
      inputRange,
      outputRange: [1, 1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <TouchableOpacity
          style={[styles.songItem, currentSongIndex === index && styles.activeSongItem]}
          onPress={() => loadAndPlaySong(index)}
          onLongPress={() => removeSong(item.id)}
          activeOpacity={0.7}>
          <View style={styles.songInfo}>
            <Ionicons
              name={currentSongIndex === index && isPlaying ? 'volume-medium' : 'musical-note'}
              size={24}
              color={currentSongIndex === index ? '#1DB954' : '#666'}
            />
            <View style={styles.songDetails}>
              <Text style={[styles.songName, currentSongIndex === index && styles.activeSongName]} numberOfLines={1}>
                {item.name}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => removeSong(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="trash-outline" size={20} color="#666" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />
      
      <Animated.View style={[styles.header, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        <Text style={styles.headerTitle}>My Music</Text>
        <Text style={styles.headerSubtitle}>{playlist.length} songs</Text>
      </Animated.View>

      {playlist.length === 0 ? (
        <Animated.View style={[styles.emptyState, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          <Ionicons name="musical-notes-outline" size={80} color="#666" />
          <Text style={styles.emptyText}>No music yet</Text>
          <Text style={styles.emptySubtext}>Tap the + button to add songs</Text>
        </Animated.View>
      ) : (
        <Animated.FlatList
          data={playlist}
          renderItem={renderSongItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
        />
      )}

      {/* Mini Player */}
      {playlist.length > 0 && (
        <Animated.View style={[
          styles.miniPlayerContainer, 
          { 
            height: miniPlayerHeight,
            opacity: miniPlayerOpacity,
            transform: [{ scale: scaleAnim }]
          }
        ]}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#1DB954" />
          ) : (
            <>
              <TouchableOpacity style={styles.miniSongInfo} onPress={() => setShowEqualizer(true)}>
                <Ionicons name="musical-note" size={24} color="#1DB954" />
                <View style={styles.miniSongTextContainer}>
                  <Text style={styles.miniSongName} numberOfLines={1}>
                    {playlist[currentSongIndex]?.name || 'No song'}
                  </Text>
                  <Text style={styles.miniSongTime}>
                    {formatTime(position)} / {formatTime(duration)}
                  </Text>
                </View>
              </TouchableOpacity>
              <View style={styles.miniControls}>
                <TouchableOpacity onPress={playPrevious} style={styles.miniControlButton}>
                  <Ionicons name="play-skip-back" size={20} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={togglePlayPause} style={styles.miniPlayButton}>
                  <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={playNext} style={styles.miniControlButton}>
                  <Ionicons name="play-skip-forward" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            </>
          )}
        </Animated.View>
      )}

      {/* Equalizer Modal */}
      <Modal visible={showEqualizer} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Animated.View style={[styles.equalizerModal, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.eqTitle}>Now Playing</Text>
              <TouchableOpacity onPress={() => setShowEqualizer(false)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.nowPlayingInfo}>
              <Ionicons name="musical-note" size={60} color="#1DB954" />
              <Text style={styles.nowPlayingSong} numberOfLines={2}>
                {playlist[currentSongIndex]?.name || 'No song'}
              </Text>
            </View>

            <View style={styles.progressContainer}>
              <Text style={styles.timeText}>{formatTime(position)}</Text>
              <Slider
                style={styles.progressSlider}
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

            <View style={styles.controlsContainer}>
              <TouchableOpacity onPress={playPrevious} style={styles.controlButton}>
                <Ionicons name="play-skip-back" size={32} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={togglePlayPause} style={styles.mainPlayButton}>
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={36} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={playNext} style={styles.controlButton}>
                <Ionicons name="play-skip-forward" size={32} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.equalizerSection}>
              <Text style={styles.eqSectionTitle}>Equalizer</Text>
              <View style={styles.eqControl}>
                <Text style={styles.eqLabel}>Bass</Text>
                <Slider
                  style={styles.eqSlider}
                  minimumValue={0}
                  maximumValue={1}
                  value={bass}
                  onValueChange={setBass}
                  minimumTrackTintColor="#1DB954"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#1DB954"
                />
              </View>
              <View style={styles.eqControl}>
                <Text style={styles.eqLabel}>Treble</Text>
                <Slider
                  style={styles.eqSlider}
                  minimumValue={0}
                  maximumValue={1}
                  value={treble}
                  onValueChange={setTreble}
                  minimumTrackTintColor="#1DB954"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#1DB954"
                />
              </View>
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* Add Button */}
      <Animated.View style={{ transform: [{ scale: scaleAnim }], opacity: fadeAnim }}>
        <TouchableOpacity style={styles.addButton} onPress={pickMusicFiles} activeOpacity={0.8}>
          <Ionicons name="add-circle" size={56} color="#1DB954" />
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#121212' 
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  emptyState: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    paddingBottom: 100,
  },
  emptyText: { 
    fontSize: 24, 
    color: '#fff', 
    marginTop: 20, 
    fontWeight: '600' 
  },
  emptySubtext: { 
    fontSize: 16, 
    color: '#666', 
    marginTop: 8 
  },
  listContent: {
    paddingBottom: 120,
  },
  songItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16,
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 8,
  },
  activeSongItem: { 
    backgroundColor: '#282828',
  },
  songInfo: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    flex: 1 
  },
  songDetails: { 
    marginLeft: 12,
    flex: 1,
  },
  songName: { 
    color: '#fff', 
    fontSize: 16 
  },
  activeSongName: { 
    color: '#1DB954', 
    fontWeight: '600' 
  },
  miniPlayerContainer: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: '#282828',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  miniSongInfo: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    flex: 1,
    marginRight: 8,
  },
  miniSongTextContainer: {
    marginLeft: 8,
    flex: 1,
  },
  miniSongName: { 
    color: '#fff', 
    fontWeight: '600',
    fontSize: 14,
  },
  miniSongTime: {
    color: '#999',
    fontSize: 11,
    marginTop: 2,
  },
  miniControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniControlButton: {
    padding: 6,
  },
  miniPlayButton: { 
    padding: 8, 
    backgroundColor: '#1DB954', 
    borderRadius: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
  },
  equalizerModal: {
    backgroundColor: '#1e1e1e',
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  eqTitle: { 
    fontSize: 24, 
    fontWeight: '700', 
    color: '#fff',
  },
  nowPlayingInfo: {
    alignItems: 'center',
    marginBottom: 24,
  },
  nowPlayingSong: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    marginTop: 16,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  progressSlider: {
    flex: 1,
    marginHorizontal: 8,
  },
  timeText: {
    color: '#999',
    fontSize: 12,
    minWidth: 40,
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 32,
    marginBottom: 32,
  },
  controlButton: {
    padding: 12,
  },
  mainPlayButton: {
    backgroundColor: '#1DB954',
    borderRadius: 36,
    padding: 16,
  },
  equalizerSection: {
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 20,
  },
  eqSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  eqControl: {
    marginBottom: 16,
  },
  eqLabel: { 
    color: '#fff', 
    fontWeight: '500',
    marginBottom: 8,
    fontSize: 14,
  },
  eqSlider: {
    width: '100%',
  },
  addButton: { 
    position: 'absolute', 
    bottom: 100, 
    right: 20,
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});